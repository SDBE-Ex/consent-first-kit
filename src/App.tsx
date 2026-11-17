import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { SessionProvider } from './session'
import {
  ConsentChoicesScreen,
  Declined,
  Done,
  FormsList,
  LanguageConsent,
  Questions,
  SyncStatus,
} from './screens/FieldScreens'
import { ConsentPreview, IdentityCheck, SetupPurpose } from './screens/SetupScreens'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <header>
          <Link to="/">Consent-First Kit</Link>
          <span className="tag">Prototype · dummy data only</span>
        </header>
        <Routes>
          <Route path="/" element={<FormsList />} />
          <Route path="/field/language" element={<LanguageConsent />} />
          <Route path="/field/choices" element={<ConsentChoicesScreen />} />
          <Route path="/field/declined" element={<Declined />} />
          <Route path="/field/questions" element={<Questions />} />
          <Route path="/field/done" element={<Done />} />
          <Route path="/field/sync" element={<SyncStatus />} />
          <Route path="/setup" element={<SetupPurpose />} />
          <Route path="/setup/identity" element={<IdentityCheck />} />
          <Route path="/setup/consent" element={<ConsentPreview />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  )
}
