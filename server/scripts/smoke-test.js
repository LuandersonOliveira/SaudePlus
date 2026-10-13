const app = require('../src/app');
const jwt = require('jsonwebtoken');
const { sanitizeDetails } = require('../src/utils/audit');
const { isValidCPF, isValidCNS, parsePagination } = require('../src/utils/validators');

function assert(cond, message) {
    if (!cond) throw new Error(message);
}

// Minta tokens locais (sem tocar no banco) para exercitar o RBAC.
function tokenFor(role, adminLevel) {
    return jwt.sign(
        { id: '00000000-0000-0000-0000-000000000000', email: 't@t.local', role, admin_level: adminLevel || null, full_name: 'Teste' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
    );
}

async function main() {
    // ---- Checagens puras (sem HTTP nem banco) ----
    assert(isValidCPF('529.982.247-25') === true, 'CPF válido deveria passar');
    assert(isValidCPF('111.111.111-11') === false, 'CPF repetido deveria falhar');
    assert(isValidCNS('898001234567891') === true, 'CNS 898 válido deveria passar');
    assert(isValidCNS('123') === false, 'CNS curto deveria falhar');
    const masked = sanitizeDetails('agendou cpf 52998224725 e Bearer abc123 token="x"');
    assert(!masked.includes('52998224725'), 'audit deveria mascarar CPF');
    assert(!masked.includes('Bearer abc123'), 'audit deveria redigir Bearer');
    assert(masked.includes('[redigido]'), 'audit deveria marcar [redigido]');
    const pg = parsePagination({ page: '2', pageSize: '10' });
    assert(pg.wantsPaged && pg.page === 2 && pg.pageSize === 10 && pg.offset === 10, 'paginação page=2/size=10');
    const legacy = parsePagination({});
    assert(legacy.wantsPaged === false, 'sem query não deveria pedir envelope');

    // ---- Checagens HTTP (sem banco: /health + middlewares) ----
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        const health = await fetch(`${base}/health`);
        if (health.status !== 200) throw new Error(`GET /health retornou ${health.status}`);
        const healthBody = await health.json();
        if (!healthBody.ok) throw new Error('GET /health não retornou ok=true');

        // Fase 0, item 0.1: helmet ativo, sem fingerprint de framework.
        assert(
            health.headers.get('x-content-type-options') === 'nosniff',
            'helmet deveria enviar X-Content-Type-Options: nosniff'
        );
        assert(!health.headers.get('x-powered-by'), 'helmet deveria remover X-Powered-By');

        // Fase 0, item 0.1: origem fora da allowlist é bloqueada (não vaza dado).
        const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
        assert(evil.status === 403, `origem não permitida deveria retornar 403, retornou ${evil.status}`);

        const protectedRoutes = ['/admin/stats', '/admin/export/summary.csv', '/health-units/manage', '/me/reminders'];
        for (const route of protectedRoutes) {
            const response = await fetch(base + route);
            if (response.status !== 401) throw new Error(`${route} deveria retornar 401 sem token, retornou ${response.status}`);
        }

        // ---- P0: RBAC cross-role (o front esconder não basta; o back precisa barrar) ----
        const paciente = { Authorization: `Bearer ${tokenFor('paciente')}` };
        const atendente = { Authorization: `Bearer ${tokenFor('atendente')}` };
        const adminAtendimento = { Authorization: `Bearer ${tokenFor('admin', 'atendimento')}` };
        const adminAlertas = { Authorization: `Bearer ${tokenFor('admin', 'alertas')}` };

        const forbidden = [
            ['paciente -> /admin/stats', '/admin/stats', paciente, 403, 'GET'],
            ['paciente -> /admin/users', '/admin/users', paciente, 403, 'GET'],
            ['paciente -> /staff/appointments', '/staff/appointments', paciente, 403, 'GET'],
            ['atendente -> /admin/stats', '/admin/stats', atendente, 403, 'GET'],
            // P0.3: atendente não pode decifrar/exfiltrar CPF/CNS via RNDS
            ['atendente -> /interop/rnds/send', '/interop/rnds/send', atendente, 403, 'POST'],
            // P0.4: admin sem a permissão 'users' não gerencia usuários
            ['admin(atendimento) -> /admin/users', '/admin/users', adminAtendimento, 403, 'GET'],
            // P0.4: nível 'atendimento' não tem permissão 'audit' nem 'diseases'
            ['admin(atendimento) -> /admin/audit-log', '/admin/audit-log', adminAtendimento, 403, 'GET'],
            ['admin(atendimento) -> /admin/audit-log/verify', '/admin/audit-log/verify', adminAtendimento, 403, 'GET'],
            ['admin(atendimento) -> /admin/diseases', '/admin/diseases', adminAtendimento, 403, 'GET'],
            // P3: 'units' só para gestor/superadmin
            ['admin(atendimento) -> /health-units/manage', '/health-units/manage', adminAtendimento, 403, 'GET'],
            ['admin(atendimento) -> /admin/professionals', '/admin/professionals', adminAtendimento, 403, 'GET'],
            ['admin(alertas) -> /admin/appointments', '/admin/appointments', adminAlertas, 403, 'GET'],
            ['admin(alertas) -> /health-units (POST)', '/health-units', adminAlertas, 403, 'POST'],
        ];
        for (const [label, route, headers, expected, method] of forbidden) {
            const res = await fetch(base + route, {
                method,
                headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
                body: method === 'POST' ? JSON.stringify({ kind: 'appointment', id: 'x' }) : undefined,
            });
            assert(res.status === expected, `${label} deveria retornar ${expected}, retornou ${res.status}`);
        }

        console.log('Smoke test aprovado: saúde, headers, CORS, 401s, RBAC cross-role (P0) e utils.');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main().catch((error) => {
    console.error('Smoke test falhou:', error.message);
    process.exit(1);
});
