import Link from 'next/link';
import { createProductAction } from '../../actions';

export default function NewProjectPage() {
  return (
    <main className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">New product</span>
          <h1>What are you thinking about building?</h1>
          <p className="lead">
            Give Product Studio the starting idea and choose who you want as the first Product
            Partner. The project knowledge belongs to the platform, so you can switch later.
          </p>
        </div>
      </div>

      <form action={createProductAction} className="form-card">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="name">Product name</label>
            <input className="input" id="name" name="name" required placeholder="Enterprise Livestream Platform" />
          </div>

          <div className="field">
            <label htmlFor="description">Starting idea</label>
            <textarea
              className="textarea"
              id="description"
              name="description"
              placeholder="Describe the problem, audience, commercial idea, or product you want to explore..."
            />
          </div>

          <div className="field">
            <label htmlFor="preferredProductPartner">First Product Partner</label>
            <select className="select" id="preferredProductPartner" name="preferredProductPartner" defaultValue="auto">
              <option value="auto">Auto select</option>
              <option value="openai">OpenAI / ChatGPT</option>
              <option value="anthropic">Anthropic / Claude</option>
              <option value="google">Google / Gemini</option>
            </select>
            <small>
              This selects the preferred partner only. Canonical Product Knowledge remains provider-independent.
            </small>
          </div>

          <div className="partner-options" aria-hidden="true">
            <div className="partner-option"><strong>Auto</strong><br />Route by policy and availability.</div>
            <div className="partner-option"><strong>OpenAI</strong><br />Product discussion and analysis.</div>
            <div className="partner-option"><strong>Claude</strong><br />Product challenge and engineering.</div>
            <div className="partner-option"><strong>Gemini</strong><br />Product and UI/UX perspective.</div>
          </div>

          <div className="form-actions">
            <Link className="button-secondary" href="/">Cancel</Link>
            <button className="button" type="submit">Start discovery</button>
          </div>
        </div>
      </form>
    </main>
  );
}
