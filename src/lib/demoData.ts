import type { Dataset, Question, ConsentLine } from '../types'

// DUMMY DATA ONLY. No real health data may enter this prototype
// until SRHIN, an ethics process and a DPIA are in place.
export const demoDataset: Dataset = {
  id: 'demo-wellbeing-check',
  title: 'Demo: community wellbeing check',
  purpose: 'Demo only: test the consent and collection flow with dummy answers.',
  end_date: '2027-01-31',
  identity_fields: [],
  register: 'formal',
  status: 'published',
  consent: [
    {
      id: 'c1',
      en: 'You decide how your answers are used. You can say no to any part, and you can change your mind later.',
      yo: '',
      yo_approved: false,
    },
  ],
  questions: [
    {
      id: 'q1',
      kind: 'single',
      en: 'Over the last two weeks, how often have you felt down?',
      yo: '',
      yo_approved: false,
      options: ['Not at all', 'Some days', 'Most days', 'Nearly every day'].map((en) => ({ en, yo: '', yo_approved: false })),
    },
    { id: 'q2', kind: 'text', en: 'Who do you talk to when things are hard?', yo: '', yo_approved: false },
  ],
}

const L = (en: string) => ({ en, yo: '', yo_approved: false })
const consent = (...lines: string[]): ConsentLine[] => lines.map((en, i) => ({ id: `c${i + 1}`, ...L(en) }))
const single = (id: string, en: string, opts: string[]): Question => ({ id, kind: 'single', ...L(en), options: opts.map(L) })
const text = (id: string, en: string): Question => ({ id, kind: 'text', ...L(en) })

/** Starting points for programme leads. Everything is editable before publishing. */
export const templates: { key: string; name: string; build: () => Omit<Dataset, 'id' | 'end_date'> }[] = [
  {
    key: 'wellbeing',
    name: 'Wellbeing check',
    build: () => ({
      title: 'Community wellbeing check',
      purpose: 'Understand how people in this community are feeling so outreach can plan support.',
      identity_fields: [],
      register: 'formal',
      consent: consent(
        'We would like to ask you a few questions about how you have been feeling.',
        'You decide how your answers are used. You can say no to any part, and you can change your mind later.',
        'Your name is not stored with your answers.',
      ),
      questions: [
        single('q1', 'Over the last two weeks, how often have you felt down?', ['Not at all', 'Some days', 'Most days', 'Nearly every day']),
        single('q2', 'How well have you been sleeping?', ['Well', 'Sometimes badly', 'Badly most nights']),
        text('q3', 'Who do you talk to when things are hard?'),
      ],
    }),
  },
  {
    key: 'intake',
    name: 'Outreach intake',
    build: () => ({
      title: 'Outreach visit intake',
      purpose: 'Record what support people need at an outreach visit so the team can follow up.',
      identity_fields: ['phone'],
      register: 'formal',
      consent: consent(
        'We would like to note what support you need today.',
        'We will only use your phone number to follow up about this visit.',
        'You can say no to any part, and you can change your mind later.',
      ),
      questions: [
        single('q1', 'What do you need help with today?', ['Health check', 'Medicine', 'Someone to talk to', 'Other']),
        text('q2', 'Anything else you want us to know?'),
      ],
    }),
  },
  {
    key: 'blank',
    name: 'Blank form',
    build: () => ({
      title: '',
      purpose: '',
      identity_fields: [],
      register: 'formal',
      consent: consent('You decide how your answers are used. You can say no to any part, and you can change your mind later.'),
      questions: [text('q1', '')],
    }),
  },
]
