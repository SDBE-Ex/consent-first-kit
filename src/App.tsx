import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { SessionProvider } from './session'
import {
  ConsentChoicesScreen,
  Declined,
  Done,
  EnrolPhone,
  FormsList,
  LanguageConsent,
  Questions,
  SyncStatus,
} from './screens/FieldScreens'
import { FormEditor, LeadHome, ReviewYoruba } from './screens/LeadScreens'
import { CouncilHome, Decisions } from './screens/CouncilScreens'
import { ConsentCheck } from './screens/ConsentCheck'
import { SetupRedirect } from './screens/SetupScreens'

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <header>
          <Link to="/">Consent-First Kit</Link>
          <span className="tag">Prototype · dummy data only</span>
        </header>
        <Routes>
          {/* Journey B: health worker in the field */}
          <Route path="/" element={<FormsList />} />
          <Route path="/field/language" element={<LanguageConsent />} />
          <Route path="/field/choices" element={<ConsentChoicesScreen />} />
          <Route path="/field/declined" element={<Declined />} />
          <Route path="/field/questions" element={<Questions />} />
          <Route path="/field/done" element={<Done />} />
          <Route path="/field/sync" element={<SyncStatus />} />
          <Route path="/field/enrol" element={<EnrolPhone />} />
          {/* Journey A: programme lead */}
          <Route path="/lead" element={<LeadHome />} />
          <Route path="/lead/form/:id" element={<FormEditor />} />
          <Route path="/lead/form/:id/review" element={<ReviewYoruba />} />
          {/* Journey C: a person checks or changes their choices */}
          <Route path="/consent" element={<ConsentCheck />} />
          {/* Journey D: the community council */}
          <Route path="/council" element={<CouncilHome />} />
          <Route path="/decisions" element={<Decisions />} />
          <Route path="/setup/*" element={<SetupRedirect />} />
        </Routes>
        <footer>Yoruba drafts by African-made language AI · approved by native speakers</footer>
      </BrowserRouter>
    </SessionProvider>
  )
}
