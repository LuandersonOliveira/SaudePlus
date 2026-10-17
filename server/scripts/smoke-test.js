/**
 * Comando curto de verificação — o que o README manda rodar depois de
 * `npm run setup`.
 *
 * A matriz RBAC NÃO está aqui: ela vive em rbac-matrix.js e é compartilhada
 * com a suíte completa (server/test/api.test.js). Copiar os casos para os
 * dois lados faria o smoke-test verde dizer nada sobre a suíte.
 */
const app = require('../src/app');
const { sanitizeDetails } = require('../src/utils/audit');
const { isValidCPF, isValidCNS, parsePagination } = require('../src/utils/validators');
const { verificarRbac } = require('./rbac-matrix');

function assert(cond, message) {
    if (!cond) throw new Error(message);
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

        // helmet ativo, sem fingerprint de framework.
        assert(
            health.headers.get('x-content-type-options') === 'nosniff',
            'helmet deveria enviar X-Content-Type-Options: nosniff'
        );
        assert(!health.headers.get('x-powered-by'), 'helmet deveria remover X-Powered-By');

        // Origem fora da allowlist é bloqueada (não vaza dado).
        const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
        assert(evil.status === 403, `origem não permitida deveria retornar 403, retornou ${evil.status}`);

        // ---- P0: RBAC cross-role (o front esconder não basta; o back precisa barrar) ----
        const rbac = await verificarRbac(base);
        if (!rbac.ok) throw new Error(`RBAC: ${rbac.falhas.join('; ')}`);

        console.log(
            `Smoke test aprovado: saúde, headers, CORS, ${rbac.casos} asserts de RBAC cross-role (P0) e utils.`
        );
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

main().catch((error) => {
    console.error('Smoke test falhou:', error.message);
    process.exit(1);
});