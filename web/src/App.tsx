import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { getLastMode } from './lib/prefs';
import { TabBar } from './components/ui';
import { ForgotPage, InvitePage, LoginPage, ResetPage } from './pages/Auth';
import { TodayPage } from './pages/Today';
import { WorkoutPage } from './pages/Workout';
import { CoachProgramsPage, EditProgramPage, NewProgramPage, ProgramsPage } from './pages/Programs';
import { CoachProgressPage, ProgressPage } from './pages/Progress';
import { CheckDetailPage, CheckFormPage, ChecksPage } from './pages/Checks';
import { AthleteProfilePage, AthletesPage, CheckReviewPage, CoachChecksPage, DashboardPage, ExerciseThreadPage } from './pages/Coach';
import { AccountPage } from './pages/Account';

export function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <main className="center-page"><div className="skeleton" /><div className="skeleton" style={{ width: '60%' }} /></main>;

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
  const home = coach && getLastMode(user.id) === 'coach' ? '/coach' : '/';
  const inSession = loc.pathname === '/seduta';
  return (
    <div className={inSession ? '' : 'app'}>
      <Routes>
        {/* Il mio allenamento / atleta */}
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
        {/* Area coach */}
        {coach && (
          <>
            <Route path="/coach" element={<DashboardPage />} />
            <Route path="/coach/progressi" element={<CoachProgressPage />} />
            <Route path="/coach/check" element={<CoachChecksPage />} />
            <Route path="/schede" element={<CoachProgramsPage />} />
            <Route path="/schede/nuova" element={<NewProgramPage mode="manual" />} />
            <Route path="/schede/importa" element={<NewProgramPage mode="pdf" />} />
            <Route path="/schede/:programId/modifica" element={<EditProgramPage />} />
            <Route path="/atleti" element={<AthletesPage />} />
            <Route path="/atleti/:athleteId" element={<AthleteProfilePage />} />
            <Route path="/atleti/:athleteId/esercizio/:key" element={<ExerciseThreadPage />} />
            <Route path="/atleti/:athleteId/check/:checkId" element={<CheckReviewPage />} />
            <Route path="/atleti/:athleteId/scheda" element={<ProgramsPage />} />
            <Route path="/atleti/:athleteId/scheda/nuova" element={<NewProgramPage mode="manual" />} />
            <Route path="/atleti/:athleteId/scheda/importa" element={<NewProgramPage mode="pdf" />} />
            <Route path="/atleti/:athleteId/scheda/:programId/modifica" element={<EditProgramPage />} />
          </>
        )}
        <Route path="/login" element={<Navigate to={home} replace />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
      {!inSession && <TabBar />}
    </div>
  );
}
