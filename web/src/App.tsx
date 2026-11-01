import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole } from '@/components/RequireRole'
import { ScrollToHash } from '@/components/ScrollToHash'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthPage } from '@/pages/AuthPage'
import { LandingPage } from '@/pages/LandingPage'
import { PrivacyPage } from '@/pages/PrivacyPage'

// Áreas autenticadas pesadas carregam sob demanda.
const StaffRoutes = lazy(() => import('@/features/staff/StaffRoutes'))
const PatientRoutes = lazy(() => import('@/features/patient/PatientRoutes'))
const AdminRoutes = lazy(() => import('@/features/admin/AdminRoutes'))

function PageFallback() {
  return (
    <div className="mx-auto grid max-w-[1080px] gap-4 p-8" role="status" aria-label="Carregando">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64" />
    </div>
  )
}

export default function App() {
  return (
    <>
      <ScrollToHash />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/auth" element={<AuthPage />} />

          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="/admin/*" element={<AdminRoutes />} />
          </Route>
          <Route element={<RequireRole roles={['admin', 'atendente']} />}>
            <Route path="/atendente/*" element={<StaffRoutes />} />
          </Route>
          {/* Como no legado, admin e atendente que abrem o painel do paciente vão para o painel deles. */}
          <Route element={<RequireRole roles={['paciente']} />}>
            <Route path="/dashboard/*" element={<PatientRoutes />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
