// Presenter dock: walks DEMO_STEPS with Prev/Next, shows each step's line as a caption.
import { $, h, mount } from './dom.js';

export function createPresenter({ steps, onStep, onToggle }) {
  const dock = $('presenter');
  const toggle = $('present-btn');
  const stepsEl = $('presenter-steps');
  const say = $('presenter-say');
  const prev = $('step-prev');
  const next = $('step-next');
  const nextLabel = $('step-next-label');
  let index = -1;

  function render() {
    const focusedStep = stepsEl.contains(document.activeElement) ? document.activeElement.dataset.step : null;
    mount(stepsEl, steps.map((s, i) => h(`button.pstep${i === index ? '.is-current' : ''}${i < index ? '.is-done' : ''}`, {
      type: 'button', 'aria-label': `Step ${i + 1}: ${s.caseId}`, 'aria-current': i === index ? 'step' : null,
      dataset: { step: String(i) }, onclick: () => go(i),
    }, String(i + 1))));
    if (focusedStep !== null && focusedStep !== undefined) stepsEl.querySelector(`[data-step="${focusedStep}"]`)?.focus();
    say.textContent = index < 0
      ? 'Five steps, about a minute. Each one opens a case, picks a photo and runs the second look.'
      : steps[index].say;
    say.classList.toggle('is-intro', index < 0);
    prev.disabled = index <= 0;
    nextLabel.textContent = index < 0 ? 'Start' : index >= steps.length - 1 ? 'Replay' : 'Next';
    next.setAttribute('aria-label', index < 0 ? 'Start demo script' : index >= steps.length - 1 ? 'Replay from step 1' : `Next: step ${index + 2}`);
  }

  function go(i) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    render();
    onStep(steps[index], index);
  }

  const isOpen = () => !dock.hidden;
  function setOpen(open) {
    dock.hidden = !open;
    toggle.setAttribute('aria-pressed', String(open));
    document.body.classList.toggle('has-presenter', open);
    onToggle?.(open);
  }

  toggle.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) next.focus();
  });
  $('presenter-close').addEventListener('click', () => { setOpen(false); toggle.focus(); });
  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index >= steps.length - 1 ? 0 : index + 1));

  render();
  return {
    isOpen,
    setOpen,
    next: () => go(index >= steps.length - 1 ? 0 : index + 1),
    prev: () => { if (index > 0) go(index - 1); },
  };
}
