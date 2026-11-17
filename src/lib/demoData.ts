import type { Dataset } from '../types'

// DUMMY DATA ONLY. No real health data may enter this prototype
// until SRHIN, an ethics process and a DPIA are in place.
export const demoDataset: Dataset = {
  id: 'demo-wellbeing-check',
  title: 'Demo: community wellbeing check',
  purpose: 'Demo only: test the consent and collection flow with dummy answers.',
  endDate: '2027-01-31',
  identityFields: [],
  questions: [
    {
      id: 'q1',
      label: { en: 'Over the last two weeks, how often have you felt down?', yo: '' },
      kind: 'single',
      options: [
        { en: 'Not at all', yo: '' },
        { en: 'Some days', yo: '' },
        { en: 'Most days', yo: '' },
        { en: 'Nearly every day', yo: '' },
      ],
    },
    {
      id: 'q2',
      label: { en: 'Who do you talk to when things are hard?', yo: '' },
      kind: 'text',
    },
  ],
}
