import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './AdminLayout'
import { DoencasPage } from './diseases/DoencasPage'
import { RedePage } from './network/RedePage'
import { ProfissionaisPage } from './professionals/ProfissionaisPage'
import { PessoasPage } from './people/PessoasPage'
import { AdminAccountPage } from './pages/AccountPage'
import { AtendimentosPage } from './pages/AtendimentosPage'
import { AuditPage } from './pages/AuditPage'
import { CadastrosPage } from './pages/CadastrosPage'
import { OverviewPage } from './pages/OverviewPage'
import { RequireCap } from './RequireCap'

/** Rotas de /admin/*. Carregado sob demanda (React.lazy). Cada seção exige a capacidade do nível. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AdminLayout />}>
        <Route index element={<OverviewPage />} />

        <Route element={<RequireCap cap="appointments" />}>
          <Route path="atendimentos" element={<AtendimentosPage />} />
        </Route>

        <Route element={<RequireCap any={['users', 'units', 'diseases']} />}>
          <Route path="cadastros" element={<CadastrosPage />}>
            <Route element={<RequireCap cap="users" />}>
              <Route path="pessoas" element={<PessoasPage />} />
            </Route>
            <Route element={<RequireCap cap="units" />}>
              <Route path="rede" element={<RedePage />} />
              <Route path="profissionais" element={<ProfissionaisPage />} />
            </Route>
            <Route element={<RequireCap cap="diseases" />}>
              <Route path="doencas" element={<DoencasPage />} />
            </Route>
          </Route>
        </Route>

        <Route element={<RequireCap cap="audit" />}>
          <Route path="auditoria" element={<AuditPage />} />
        </Route>

        <Route path="conta" element={<AdminAccountPage />} />
        {/* Endereço inexistente dentro da área volta ao Início (em vez de uma página em branco). */}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  )
}
