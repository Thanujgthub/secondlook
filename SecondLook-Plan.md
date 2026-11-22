# SecondLook — Plan of Action

*2026-11-22 · IDEA//FORGE · Track 1: Civic Pulse*

## Summary

SecondLook (formerly "Fixed?") is a one-screen app. Before a ward supervisor closes a streetlight complaint, it checks whether the repair photo actually shows what the resident asked to have fixed.

The first version proves one thing: **the same photo can pass for one complaint and fail for another.** A night photo of one lit lamp answers "the light by Gate 2 is dark", but not "the whole row by Gate 2 is dark". Two people can build it in about 100 minutes as one Python file.

## Problem

Complaints get closed with photos that do not prove the fix. In Gurugram, resident Subrata Dutta reported a stretch of broken streetlights. Officials closed the case with a daytime photo of the poles, which cannot show whether a lamp works at night. ([Hindustan Times](https://www.hindustantimes.com/cities/gurugram-news/mcgs-24-hour-grievance-redressal-portal-faces-flak-over-delays-incomplete-fixes-101793211559872.html))

Supervisors review many closures a day and rarely compare the photo against the exact wording of the complaint. The resident is left with a closed ticket and a street that may still be dark.

## How it works

The supervisor enters the complaint, uploads the repair photo and clicks **Review photo**. The AI never closes a case. It either asks for a better photo or hands the case to the supervisor.

```
 Complaint text ─┐
                 ├─► SecondLook review ─► Photo shows the fix? ──yes──► Ready for review ──supervisor accepts──► Supervisor closes
 Repair photo ───┘    (AI compares both)          │
      ▲                                           no
      │                                           ▼
      └──── specific request, e.g. a night shot ── Ask for a new photo
```

A weak photo loops back with one specific request, such as "show this lamp switched on after dark with the Gate 2 sign in frame".

## The demo (60 seconds)

Judges see the review change when only the complaint changes. Complaint: *"The streetlight beside Gate 2 stays dark at night."*

1. **0–20 s.** Read the complaint aloud. Upload the daytime photo of the Gate 2 pole. SecondLook asks for an after-dark photo with the lamp on and the Gate 2 sign in frame.
2. **20–40 s.** Upload the night photo of the lit lamp beside the sign. SecondLook marks it ready for human review, and a teammate accepts it as the supervisor.
3. **40–60 s.** Keep the same photo. Change the complaint to *"The entire row of lights by Gate 2 stays dark."* Run it again. SecondLook now asks for a wider view, because one lit lamp says nothing about the rest of the row.

If a matched street photo pair is hard to get, use a clearly labelled tabletop lamp and a paper "Gate 2" sign.

## MVP scope

Streetlight complaints only, one photo per review, two possible outcomes. The supervisor always makes the final call.

| In the first version | Left out for now |
| --- | --- |
| Streetlight complaints, typed or picked from samples | Potholes, garbage, water and other complaint types |
| One JPG/PNG photo per review | Multiple photos, video, GPS or timestamp checks |
| Two outcomes: **Request another photo** or **Ready for human review** | Automatic closing or rejecting of complaints |
| Supervisor buttons: Accept evidence / Ask for follow-up | Login, user roles, notifications to residents |
| Review held in session memory | Database, complaint history, city-portal integration |
| English complaints | Hindi, Telugu and other languages |

Editing the complaint or replacing the photo clears the previous review and acceptance, so a stale result can never be accepted.

## Architecture and tech stack

One Python file of roughly 100–150 lines. Streamlit draws the page, and one function sends the complaint and photo together to a vision model and reads back a small JSON answer.

| Part | Choice | Why |
| --- | --- | --- |
| UI | Streamlit, single `app.py` | Upload, preview and buttons in a few lines; free hosting |
| AI review | One vision-model call per click (Claude Haiku 5.5 or Gemini Flash) | Reads image + text together; cheap and fast |
| Answer format | JSON: `status`, `observation`, `next_photo_request` | Easy to validate and show |
| State | `st.session_state` | No database needed for a demo |
| Secrets | API key in Streamlit secrets | Key never reaches the browser |
| Hosting | Streamlit Community Cloud | Public link judges can open |

Repo layout: `app.py`, `requirements.txt`, `samples/` (team-owned photos), `README.md`.

**Model instructions (core of the prompt):** identify the lamp or landmark named in the complaint, the reported problem, and how many lights it covers. Describe only what is visible. Return a status, one sentence of observation and, when something is missing, one specific request for the next photo.

**Open question:** which API key does the team already have? Either model works; pick the one with free credits.

References: [Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding) · [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) · [Streamlit secrets](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/secrets-management)

## Build plan

Two people, about 100 minutes, working in parallel from minute 0. The **app owner** builds the code; the **demo owner** owns photos, test cases and the pitch.

| Time | Work | Done when |
| --- | --- | --- |
| 0–15 min | App owner: test one image + text API call. Demo owner: write the Gate 2 complaint, shoot a day/night photo pair, write the "whole row" complaint. | One real model reply and a usable photo pair |
| 15–40 min | Build the screen: sample picker, complaint box, JPG/PNG upload, preview, **Review photo** button. | A teammate can change either input and see what will be reviewed |
| 40–65 min | Send complaint + photo together, validate the JSON, show the observation, wire up Accept / Ask for follow-up. | Day and night photos take different paths |
| 65–85 min | Run the six test cases below. Tighten the prompt if a weak photo passes; re-run all cases after each change. | Every case matches its expected result |
| 85–100 min | Deploy to Streamlit Community Cloud, add the key as a secret, open the link in a private window, rehearse the demo. | A judge can run both photo examples from the public link |

### Test cases

A teammate labels the photos before seeing any AI output. Judge each reply by its decision and the visible detail it cites, not its exact wording.

| Case | Expected result |
| --- | --- |
| Day photo of the correct pole | Request a night photo with the lit lamp and Gate 2 sign |
| Night photo of the lit Gate 2 lamp | Ready for human review; names the lamp it sees |
| Same night photo, complaint widened to the whole row | Request a wider view of the rest of the row |
| Night photo at Gate 3, or a blurry photo with no readable sign | Request a photo with an identifiable Gate 2 landmark |
| Complaint edited or photo replaced after acceptance | Old result and acceptance cleared; fresh review required |
| API timeout or unreadable reply | "Review unavailable" with Retry; Accept stays disabled |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Model passes a weak photo (e.g. daytime pole) | Prompt asks for visible evidence only; test cases catch it; the supervisor still decides |
| No matching real street photos | Tabletop lamp + paper "Gate 2" sign, clearly labelled as staged |
| Wi-Fi or API fails during judging | Record a 60-second backup video; show cached sample results |
| One photo can't prove a lamp keeps working | Say so on screen: SecondLook checks the evidence, not the repair history |
| API key leaks | Key only in Streamlit secrets, never in the repo |

## Ready to submit

SecondLook is ready when all six test cases pass from the public link and the demo runs in under 60 seconds.

- [ ] Pick the model and get an API key
- [ ] Shoot the day/night Gate 2 photo pair
- [ ] Build and deploy `app.py`
- [ ] Pass all six test cases
- [ ] Record the backup demo video
- [ ] Write the problem statement and credit the model and photo sources
- [ ] Check the required fields on Challazo and submit

After the hackathon, the same check extends to potholes, garbage pickup and water leaks. Each needs only a new line in the prompt about what a convincing "after" photo shows.

Source: [IDEA//FORGE themes and participation guide](https://docs.google.com/document/d/1dHVb7Yq5GC5QG3crKq1v24FYWGdItNaSrXNty01Lj2o/edit?tab=t.0)
