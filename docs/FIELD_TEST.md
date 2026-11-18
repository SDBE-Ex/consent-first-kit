# Timed field test: Consent-First Kit vs Google Forms

Purpose: get the real numbers the letter of intent will quote. Nothing estimated is reported as fact; every figure in the letter comes from the results sheet, and anything not tested stays in [brackets].

Principle 1 is the test: a health worker finishes consent plus a 10-question form in **less time than with their current tool**. If not, cut steps, not corners.

## Rules before anyone is tested

- **Dummy data only.** Health workers role-play a respondent with made-up answers. No real person's health information is entered into either tool, and nothing is recorded about a real respondent. Real community pilots wait for SRHIN, an ethics process and a data protection impact assessment.
- **Consent for the test itself.** Tell each health worker what is timed and why. Timings are recorded against a code (HW1, HW2, ...), not a name. They may stop at any time.
- **Same form, same questions, same language** in both tools. The kit form is the published "Community wellbeing check" (or the demo form until the Yoruba lines are approved). Build the same questions in Google Forms.
- **Google Forms gets its fair setup:** the questions already built, the link already open on the phone, the same wording of the consent text pasted at the top. Do not handicap it.
- **The kit gets its fair setup:** the phone is already enrolled, the form already downloaded to the phone (open it once online), and the phone is in the state a health worker would really have it.

## Who and how many

3 to 5 health workers or outreach volunteers who already collect information. Ask at the start (record the answers; they help the letter):

1. What tool do you use to collect health information now, and why that one?
2. What happens to the data after collection? Who gets copies?
3. Smartphone or basic phone? What model? (This settles offline Android vs SMS/USSD.)

## Design

Each person does **both** tools, on the **same phone**, with a different made-up respondent each time. Alternate the order so practice does not favour one tool: HW1 kit first, HW2 Google Forms first, and so on.

Per tool, per person:
1. Hand over the phone with the tool ready. Say: "Collect consent and ten answers from this person." The tester role-plays the respondent from a prepared card of answers.
2. **Start the stopwatch** when the health worker taps the first thing (opening the form).
3. **Stop** when the form is saved or submitted (kit: the check code screen; Google Forms: "response recorded").
4. Record the time. Record any error, stuck moment or help given.

Use one stopwatch, the same person timing every run. Round to the second.

## Extra runs

- **Offline.** Put the phone in airplane mode and collect one record in the kit. Then turn signal on and sync. Record whether any data was lost (target: none).
- **Consent understood.** After the kit's consent screen, ask the respondent to say back their three choices (care, research, AI training) in their own words. Record how many of the three they explain correctly. Do this on 3 or more respondents in total.
- **Identity kept apart.** After the tests, check in the database that no answers row holds a name or phone (the lead checks with the SQL below).
- **Would switch.** After both tools, ask: "Would you use this instead of what you use now? What would stop you?" Record yes / no / only if, and the words.

## Results sheet

`docs/field-test/results-template.csv`. Copy it to a new file per session and fill it in. Keep results out of git if they contain anything beyond codes and times.

## What we report

| Measure | How it is computed | Target |
|---|---|---|
| Time, kit | median and range of the kit runs | faster than Google Forms [confirm after test] |
| Time, Google Forms | median and range of the Google Forms runs | n/a |
| Difference | median kit minus median Google Forms, plus how many people were faster with the kit | [from data] |
| Consent understood | explained correctly out of asked, for each choice | [X] of [Y] |
| Identity apart | answer rows with a name or phone in them | 0 |
| Works offline | records lost after sync | 0 |
| Would switch | yes / only if / no | [X] of [Y] |

With 3 to 5 people, report medians and the raw times, and say "n = [N]". Do not state percentages. It is a small usability test, not a study.

## Identity check (lead runs in the Supabase SQL editor)

```sql
-- Answers must never contain identity. Expect 0 rows.
select id from answers.responses
where answers::text ~* '(name|phone|address)';
-- Identity lives apart: rows here, none of them joined to answers by anything but the check code.
select count(*) from identity.people;
```

If a question's wording legitimately contains the word "name", read the matching rows by eye rather than trusting the pattern.

## If the kit is slower

Record where the time went (which screen, how long). That is the finding. Cut or merge the slowest step, test again with fresh respondents, and report both rounds. Do not drop the principle.
