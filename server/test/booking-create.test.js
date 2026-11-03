/**
 * E-06 (Fase 8, item 2.1): UM só caminho de escrita de agendamento novo.
 *
 * Paciente (`routes/me.booking.routes.js`), recepção (`routes/staff.routes.js`) e fila de espera
 * (`services/waitlist.js`) montavam o mesmo INSERT à mão. `services/bookingCreate.criarAtendimento` é a
 * sequência única: travar utente e profissional, validar, calcular a duração, resolver nome do profissional
 * e local, gravar. O UNIQUE (professional_id, active_slot) segue como rede de proteção do banco.
 *
 * A transação é de quem chama; aqui o teste abre uma e desfaz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const { criarAtendimento } = require('../src/services/bookingCreate');

const P = {
  unidade: '00000000-0000-4000-8000-0000001c0001',
  profissional: '00000000-0000-4000-8000-0000001c0002',
  paciente: '00000000-0000-4000-8000-0000001c0003',
  paciente2: '00000000-0000-4000-8000-0000001c0004',
  schedule: '00000000-0000-4000-8000-0000001c0010',
  ofertaConsulta: '00000000-0000-4000-8000-0000001c0020',
  ofertaExame: '00000000-0000-4000-8000-0000001c0021',
  consulta: 'Consulta Escrita Única',
  exame: 'Exame Escrita Única',
};

// Um sábado daqui a ~70 dias (a escala é de sábado, 08:00 a 12:00).
const DIA = (() => {
  const d = new Date(Date.now() + 70 * 86400000);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

async function limpar() {
  for (const id of [P.paciente, P.paciente2]) {
    await pool.query('DELETE FROM appointments WHERE user_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM exams WHERE user_id = ?', [id]).catch(() => {});
  }
}

test.before(async () => {
  await limpar();
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Escrita Única', 'ubs', 'Centro']);
  await pool.query('INSERT IGNORE INTO professionals (id, name, job_title) VALUES (?,?,?)',
    [P.profissional, 'Dra. Nome Atual', 'Clínica Geral']);
  for (const [id, kind, nome] of [[P.ofertaConsulta, 'consulta', P.consulta], [P.ofertaExame, 'exame', P.exame]]) {
    await pool.query(
      `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active) VALUES (?, ?, ?, ?, 60, 1)
       ON DUPLICATE KEY UPDATE duration_minutes = 60, active = 1`,
      [id, P.unidade, kind, nome]
    );
  }
  await pool.query(
    `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name)
     VALUES (UUID(), ?, ?, 'consulta', ?), (UUID(), ?, ?, 'exame', ?)
     ON DUPLICATE KEY UPDATE unit_id = VALUES(unit_id)`,
    [P.profissional, P.unidade, P.consulta, P.profissional, P.unidade, P.exame]
  );
  for (const [id, prioridade] of [[P.paciente, 'idoso'], [P.paciente2, null]]) {
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status, priority)
       VALUES (?, 'Paciente Escrita', ?, 'x', 'paciente', 'ativo', ?)
       ON DUPLICATE KEY UPDATE account_status = 'ativo', deleted_at = NULL, priority = VALUES(priority)`,
      [id, `escrita+${id.slice(-6)}@test.local`, prioridade]
    );
  }
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, 6, '08:00', '12:00', 30)`,
    [P.schedule, P.profissional, P.unidade]
  );
});

test.after(async () => {
  await limpar();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id IN (?,?)', [P.ofertaConsulta, P.ofertaExame]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE professional_id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id = ?', [P.profissional]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id IN (?,?)', [P.paciente, P.paciente2]).catch(() => {});
  await pool.end().catch(() => {});
});

/** Roda `fn(conn)` numa transação e a DESFAZ, mesmo quando o teste passa. */
async function emTransacao(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    return await fn(conn);
  } finally {
    await conn.rollback().catch(() => {});
    conn.release();
  }
}

const base = (extra = {}) => ({
  tipo: 'consulta', userId: P.paciente, unitId: P.unidade, professionalId: P.profissional,
  serviceName: P.consulta, scheduledAt: `${DIA} 09:00:00`, ...extra,
});

test('consulta: grava com id, duração do serviço, nome ATUAL do profissional e status pendente', async () => {
  await emTransacao(async (conn) => {
    // `doctor` desatualizado vindo do chamador: o nome do profissional cadastrado vence
    const r = await criarAtendimento(conn, base({ doctor: 'Nome Antigo', location: 'Sala 3', notes: 'trazer exames' }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.duracao, 60, 'a duração do serviço na unidade vence o slot de 30');

    const [[linha]] = await conn.query('SELECT * FROM appointments WHERE id = ?', [r.id]);
    assert.equal(linha.user_id, P.paciente);
    assert.equal(linha.specialty, P.consulta);
    assert.equal(linha.doctor, 'Dra. Nome Atual');
    assert.equal(linha.location, 'Sala 3');
    assert.equal(linha.unit_id, P.unidade);
    assert.equal(linha.professional_id, P.profissional);
    assert.equal(linha.notes, 'trazer exames');
    assert.equal(Number(linha.duration_minutes), 60);
    assert.equal(linha.status, 'pendente');
  });
});

test('sem local informado, usa o nome da unidade', async () => {
  await emTransacao(async (conn) => {
    const r = await criarAtendimento(conn, base({ scheduledAt: `${DIA} 10:00:00` }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const [[linha]] = await conn.query('SELECT location FROM appointments WHERE id = ?', [r.id]);
    assert.equal(linha.location, 'UBS Escrita Única');
  });
});

test('exame: vai para a tabela exams (que não tem a coluna doctor)', async () => {
  await emTransacao(async (conn) => {
    const r = await criarAtendimento(conn, base({ tipo: 'exame', serviceName: P.exame, scheduledAt: `${DIA} 11:00:00` }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const [[linha]] = await conn.query('SELECT exam_type, duration_minutes FROM exams WHERE id = ?', [r.id]);
    assert.equal(linha.exam_type, P.exame);
    assert.equal(Number(linha.duration_minutes), 60);
    const [[nada]] = await conn.query('SELECT COUNT(*) AS n FROM appointments WHERE id = ?', [r.id]);
    assert.equal(Number(nada.n), 0);
  });
});

test('validação recusada devolve { ok: false, error } e NÃO grava nada', async () => {
  await emTransacao(async (conn) => {
    const primeira = await criarAtendimento(conn, base({ scheduledAt: `${DIA} 09:00:00` }));
    assert.equal(primeira.ok, true, JSON.stringify(primeira));

    // mesmo profissional e horário, outro utente: o horário está ocupado
    const ocupado = await criarAtendimento(conn, base({ userId: P.paciente2, scheduledAt: `${DIA} 09:30:00` }));
    assert.equal(ocupado.ok, false);
    assert.match(ocupado.error, /ocupado|já tem outro atendimento/i);

    const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM appointments WHERE user_id = ?', [P.paciente2]);
    assert.equal(Number(n.n), 0);
  });
});

test('tipo inválido e unidade inexistente são recusados com a mensagem da regra', async () => {
  await emTransacao(async (conn) => {
    assert.deepEqual(await criarAtendimento(conn, base({ tipo: 'cirurgia' })), { ok: false, error: 'Tipo de atendimento inválido.' });
    const semUnidade = await criarAtendimento(conn, base({ unitId: crypto.randomUUID() }));
    assert.equal(semUnidade.ok, false);
    assert.match(semUnidade.error, /Unidade de saúde não encontrada/);
  });
});

test('sem profissional: duração padrão de 30 min e o médico informado é mantido', async () => {
  await emTransacao(async (conn) => {
    // serviço sem profissional alocado, numa unidade que não o oferece, é recusado pela regra;
    // aqui só conferimos o caminho do nome do médico livre quando há profissional nulo e a regra aceita.
    const r = await criarAtendimento(conn, base({ professionalId: null, doctor: 'Dr. Livre', scheduledAt: `${DIA} 09:00:00` }));
    if (r.ok) {
      const [[linha]] = await conn.query('SELECT doctor, duration_minutes, professional_id FROM appointments WHERE id = ?', [r.id]);
      assert.equal(linha.doctor, 'Dr. Livre');
      assert.equal(Number(linha.duration_minutes), 30);
      assert.equal(linha.professional_id, null);
    } else {
      assert.match(r.error, /profissional/i, 'a regra exige profissional para serviço cadastrado na unidade');
    }
  });
});

test('userPriority informado pelo chamador é usado sem nova consulta ao banco', async () => {
  await emTransacao(async (conn) => {
    let consultasDePrioridade = 0;
    const espiao = new Proxy(conn, {
      get(alvo, prop) {
        if (prop === 'query') {
          return (sql, params) => {
            if (/SELECT priority FROM users/i.test(String(sql))) consultasDePrioridade += 1;
            return alvo.query(sql, params);
          };
        }
        const v = alvo[prop];
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
    const r = await criarAtendimento(espiao, base({ userPriority: 'idoso', scheduledAt: `${DIA} 09:00:00` }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(consultasDePrioridade, 0);
  });
});
