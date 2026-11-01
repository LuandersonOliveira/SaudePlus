import { Navigate, Route, Routes } from 'react-router-dom'
import { AccountPage } from './pages/AccountPage'
import { AgendaPage } from './pages/AgendaPage'
import { BookingsPage } from './pages/BookingsPage'
import { PatientsPage } from './pages/PatientsPage'
import { QueuePage } from './pages/QueuePage'
import { StaffLayout } from './StaffLayout'

/** Rotas de /atendente/*. Carregado sob demanda (React.lazy) para não pesar na landing e no login. */
export default function StaffRoutes() {
  return (
    <Routes>
      <Route path="/" element={<StaffLayout />}>
        <Route index element={<QueuePage />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="agendamentos" element={<BookingsPage />} />
        <Route path="pacientes" element={<PatientsPage />} />
        <Route path="conta" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/atendente" replace />} />
      </Route>
    </Routes>
  )
}
