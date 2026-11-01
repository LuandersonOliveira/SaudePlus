import { Navigate, Route, Routes } from 'react-router-dom'
import { PatientLayout } from './PatientLayout'
import { AccountPage } from './pages/AccountPage'
import { AlertsPage } from './pages/AlertsPage'
import { BookPage } from './pages/BookPage'
import { HomePage } from './pages/HomePage'
import { MyBookingsPage } from './pages/MyBookingsPage'

/** Rotas de /dashboard/*. Carregado sob demanda (React.lazy). */
export default function PatientRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PatientLayout />}>
        <Route index element={<HomePage />} />
        <Route path="agendar" element={<BookPage />} />
        <Route path="agendamentos" element={<MyBookingsPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="conta" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
