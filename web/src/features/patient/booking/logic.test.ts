import { describe, expect, it } from 'vitest'
import {
  buildPayload,
  draftKey,
  EMPTY_FORM,
  findSlot,
  isReady,
  OTHER,
  parseDraft,
  pickSlot,
  reviewLines,
  sameSlot,
  serializeDraft,
  slotEntries,
  stateFromRecord,
  toDatetimeLocalValue,
} from './logic'
import type { BookingFormState, SlotUnit } from './types'

const units: SlotUnit[] = [
  {
    id: 'u1', name: 'UBS Centro', totalVagas: 3,
    dias: [
      {
        date: '2026-11-03',
        slots: [
          { hora: '09:00', professionals: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Beto' }] },
          { hora: '09:30', professional_id: 'p1', professional_name: 'Ana' },
        ],
      },
    ],
  },
]

describe('slotEntries', () => {
  it('um horário com vários profissionais vira um par por profissional', () => {
    const e = slotEntries(units[0].dias[0])
    expect(e.map((x) => `${x.hora} ${x.professional_name}`)).toEqual(['09:00 Ana', '09:00 Beto', '09:30 Ana'])
  })
  it('horário sem lista usa o profissional do próprio slot', () => {
    expect(slotEntries({ date: 'd', slots: [{ hora: '10:00', professional_id: null, professional_name: null }] })).toEqual([
      { hora: '10:00', professional_id: null, professional_name: null, job_title: undefined },
    ])
  })
})

describe('pickSlot / findSlot / sameSlot', () => {
  it('pickSlot distingue profissionais no mesmo horário', () => {
    const beto = pickSlot(units, 'u1', '2026-11-03', '09:00', 'p2')
    expect(beto).toMatchObject({ unit_name: 'UBS Centro', professional_name: 'Beto', scheduled_at: '2026-11-03 09:00:00' })
    expect(pickSlot(units, 'u1', '2026-11-03', '09:00', 'pX')).toBeNull()
    expect(pickSlot(units, 'uX', '2026-11-03', '09:00', 'p1')).toBeNull()
  })
  it('findSlot sem profissional aceita qualquer um; com profissional exige o par', () => {
    expect(findSlot(units, 'u1', '2026-11-03 09:00:00')?.professional_name).toBe('Ana')
    expect(findSlot(units, 'u1', '2026-11-03 09:00:00', 'p2')?.professional_name).toBe('Beto')
    expect(findSlot(units, 'u1', '2026-11-03 09:30:00', 'p2')).toBeNull() // Beto não atende às 09:30
    expect(findSlot(units, 'u1', '2026-11-04 09:00:00')).toBeNull()
    expect(findSlot(undefined, 'u1', '2026-11-03 09:00:00')).toBeNull()
  })
  it('sameSlot compara unidade, dia, hora e profissional', () => {
    const sel = pickSlot(units, 'u1', '2026-11-03', '09:00', 'p1')
    expect(sameSlot(sel, 'u1', '2026-11-03', '09:00', 'p1')).toBe(true)
    expect(sameSlot(sel, 'u1', '2026-11-03', '09:00', 'p2')).toBe(false)
    expect(sameSlot(null, 'u1', '2026-11-03', '09:00', 'p1')).toBe(false)
  })
})

describe('isReady', () => {
  const sel = pickSlot(units, 'u1', '2026-11-03', '09:00', 'p1')
  it('guiado exige serviço e vaga', () => {
    expect(isReady({ ...EMPTY_FORM, servico: 'Pediatria' })).toBe(false)
    expect(isReady({ ...EMPTY_FORM, servico: 'Pediatria', selecao: sel })).toBe(true)
  })
  it('manual exige serviço digitado, unidade e data/hora', () => {
    const base: BookingFormState = { ...EMPTY_FORM, servico: OTHER, manualService: 'Fisioterapia' }
    expect(isReady(base)).toBe(false)
    expect(isReady({ ...base, manualUnitId: 'u1' })).toBe(false)
    expect(isReady({ ...base, manualUnitId: 'u1', manualWhen: '2026-11-03T09:00' })).toBe(true)
    expect(isReady({ ...base, manualService: '   ', manualUnitId: 'u1', manualWhen: '2026-11-03T09:00' })).toBe(false)
  })
})

describe('buildPayload', () => {
  const sel = pickSlot(units, 'u1', '2026-11-03', '09:00', 'p2')
  const healthUnits = [{ id: 'u9', name: 'UBS Norte' }]

  it('consulta guiada leva specialty, médico e profissional da vaga', () => {
    const r = buildPayload('appointments', { ...EMPTY_FORM, servico: 'Pediatria', selecao: sel, notes: 'trazer exames' }, healthUnits)
    expect(r).toEqual({
      ok: true,
      value: {
        doctor: 'Beto',
        payload: {
          specialty: 'Pediatria', doctor: 'Beto', location: 'UBS Centro', scheduled_at: '2026-11-03 09:00:00',
          notes: 'trazer exames', unit_id: 'u1', professional_id: 'p2',
        },
      },
    })
  })
  it('exame usa exam_type e não envia specialty/doctor', () => {
    const r = buildPayload('exams', { ...EMPTY_FORM, servico: 'Hemograma', selecao: sel }, healthUnits)
    expect(r.ok && r.value.payload).toMatchObject({ exam_type: 'Hemograma', professional_id: 'p2' })
    expect(r.ok && 'specialty' in r.value.payload).toBe(false)
  })
  it('caminho manual: unidade pelo id, data com segundos e sem profissional', () => {
    const r = buildPayload('appointments', { ...EMPTY_FORM, servico: OTHER, manualService: ' Fisioterapia ', manualUnitId: 'u9', manualWhen: '2026-12-01T14:30' }, healthUnits)
    expect(r.ok && r.value.payload).toMatchObject({
      specialty: 'Fisioterapia', location: 'UBS Norte', unit_id: 'u9', scheduled_at: '2026-12-01 14:30:00', professional_id: null, doctor: null,
    })
  })
  it('mensagens de erro na ordem do legado', () => {
    const err = (s: BookingFormState, k: 'appointments' | 'exams' = 'appointments') => {
      const r = buildPayload(k, s, healthUnits)
      return r.ok ? null : r.error
    }
    expect(err(EMPTY_FORM)).toBe('Escolha o serviço.')
    expect(err({ ...EMPTY_FORM, servico: 'Pediatria' })).toBe('Escolha um horário livre abaixo.')
    expect(err({ ...EMPTY_FORM, servico: OTHER })).toBe('Informe a especialidade.')
    expect(err({ ...EMPTY_FORM, servico: OTHER }, 'exams')).toBe('Por favor, informe qual é o exame.')
    expect(err({ ...EMPTY_FORM, servico: OTHER, manualService: 'x' })).toBe('Selecione a unidade.')
    expect(err({ ...EMPTY_FORM, servico: OTHER, manualService: 'x', manualUnitId: 'u9' })).toBe('Escolha a data e a hora do atendimento.')
  })
})

describe('reviewLines', () => {
  it('mostra "A definir pela unidade" sem profissional e só inclui observações se houver', () => {
    const base = { exam_type: 'Hemograma', location: 'UBS', scheduled_at: '2026-11-03 09:00:00', notes: '', unit_id: 'u1', professional_id: null }
    const rows = reviewLines('exams', base, null)
    expect(rows.map(([k]) => k)).toEqual(['Tipo', 'Exame', 'Local', 'Profissional', 'Data e hora'])
    expect(rows[3]).toEqual(['Profissional', 'A definir pela unidade'])
    expect(reviewLines('exams', { ...base, notes: 'jejum' }, 'Ana').at(-1)).toEqual(['Observações', 'jejum'])
  })
})

describe('stateFromRecord', () => {
  const record = { id: 'a1', scheduled_at: '2026-11-03 09:00:00', status: 'pendente' as const, specialty: 'Pediatria', location: 'UBS Norte', notes: 'obs', unit_id: 'u9' }
  const healthUnits = [{ id: 'u9', name: 'UBS Norte' }]
  it('serviço do catálogo: caminho guiado, com observações na edição', () => {
    expect(stateFromRecord('appointments', record, { rebook: false, serviceKnown: true, units: healthUnits })).toMatchObject({ servico: 'Pediatria', notes: 'obs' })
  })
  it('refazer limpa observações; fora do catálogo vai para o manual com unidade e data atuais', () => {
    expect(stateFromRecord('appointments', record, { rebook: true, serviceKnown: true, units: healthUnits }).notes).toBe('')
    const manual = stateFromRecord('appointments', record, { rebook: false, serviceKnown: false, units: healthUnits })
    expect(manual).toMatchObject({ servico: OTHER, manualService: 'Pediatria', manualUnitId: 'u9', manualWhen: '2026-11-03T09:00' })
    expect(stateFromRecord('appointments', record, { rebook: true, serviceKnown: false, units: healthUnits }).manualWhen).toBe('')
  })
  it('sem unit_id válido tenta casar a unidade pelo nome do local', () => {
    expect(stateFromRecord('appointments', { ...record, unit_id: 'sumiu' }, { rebook: false, serviceKnown: false, units: healthUnits }).manualUnitId).toBe('u9')
  })
})

describe('rascunho', () => {
  const sel = pickSlot(units, 'u1', '2026-11-03', '09:00', 'p1')
  it('ida e volta preserva serviço, vaga e observações', () => {
    const raw = serializeDraft({ ...EMPTY_FORM, servico: 'Pediatria', selecao: sel, notes: 'x' })
    const back = parseDraft(raw)
    expect(back).toMatchObject({ servico: 'Pediatria', notes: 'x' })
    expect(back?.selecao).toEqual(JSON.parse(JSON.stringify(sel))) // JSON descarta campos undefined
  })
  it('formulário vazio não gera rascunho', () => expect(serializeDraft(EMPTY_FORM)).toBeNull())
  it('descarta formato antigo, JSON quebrado e rascunho vazio', () => {
    expect(parseDraft(JSON.stringify({ servico: 'x' }))).toBeNull()
    expect(parseDraft('{quebrado')).toBeNull()
    expect(parseDraft(JSON.stringify({ v: 2, servico: '', notes: '' }))).toBeNull()
    expect(parseDraft(null)).toBeNull()
  })
  it('normaliza o valor "__outra" do legado e monta a chave por usuário e tipo', () => {
    expect(parseDraft(JSON.stringify({ v: 2, servico: '__outra', manualService: 'x' }))?.servico).toBe(OTHER)
    expect(draftKey('u1', 'exams')).toBe('saude_draft_u1_exams')
    expect(draftKey(undefined, 'appointments')).toBe('saude_draft_anon_appointments')
  })
})

describe('toDatetimeLocalValue', () => {
  it('converte para o formato do input', () => {
    expect(toDatetimeLocalValue('2026-11-03 09:00:00')).toBe('2026-11-03T09:00')
    expect(toDatetimeLocalValue(null)).toBe('')
  })
})
