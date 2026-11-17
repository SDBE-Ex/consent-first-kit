// Replaced by LeadScreens.tsx (sign-in, form builder, Yoruba review). Kept as a redirect for old links.
import { Navigate } from 'react-router-dom'

export function SetupRedirect() {
  return <Navigate to="/lead" replace />
}
