import { Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { TabBar } from './components/ui';
import { ForgotPage, InvitePage, LoginPage, ResetPage } from './pages/Auth';
import { TodayPage } from './pages/Today';
import { WorkoutPage } from './pages/Workout';
import { EditProgramPage, NewProgramPage, ProgramsPage } from './pages/Programs';
import { ProgressPage } from './pages/Progress';
import { CheckDetailPage, CheckFormPage, ChecksPage } from './pages/Checks';
import { AthleteProfilePage, AthletesPage } from './pages/Coach';
import { AccountPage } from './pages/Account';

export function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <main className="center-page"><p className="muted">Carico…</p></main>;

  if (!user) {
    return (
      <Routes>
        <Route path="/invito" element={<InvitePage />} />
        <Route path="/recupera" element={<ForgotPage />} />
        <Route path="/reimposta-password" element={<ResetPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const coach = user.role === 'coach';
  const inSession = loc.pathname === '/seduta';
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/seduta" element={<WorkoutPage />} />
        <Route path="/scheda" element={<ProgramsPage />} />
        <Route path="/scheda/nuova" element={<NewProgramPage mode="manual" />} />
        <Route path="/scheda/importa" element={<NewProgramPage mode="pdf" />} />
        <Route path="/scheda/:programId/modifica" element={<EditProgramPage />} />
        <Route path="/progressi" element={<ProgressPage />} />
        <Route path="/check" element={<ChecksPage />} />
        <Route path="/check/nuovo" element={<CheckFormPage />} />
        <Route path="/check/:checkId" element={<CheckDetailPage />} />
        <Route path="/check/:checkId/modifica" element={<CheckFormPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/invito" element={<InvitePage />} />
        {coach && (
          <>
            <Route path="/atleti" element={<AthletesPage />} />
            <Route path="/atleti/:athleteId" element={<AthleteProfilePage />} />
            <Route path="/atleti/:athleteId/scheda" element={<ProgramsPage />} />
            <Route path="/atleti/:athleteId/scheda/nuova" element={<NewProgramPage mode="manual" />} />
            <Route path="/atleti/:athleteId/scheda/importa" element={<NewProgramPage mode="pdf" />} />
            <Route path="/atleti/:athleteId/scheda/:programId/modifica" element={<EditProgramPage />} />
          </>
        )}
        <Route path="/login" element={<Navigate to={coach ? '/atleti' : '/'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!inSession && (
        <>
          <p style={{ textAlign: 'center' }}><Link to="/account" className="muted">Account</Link></p>
          <TabBar />
        </>
      )}
    </div>
  );
}
