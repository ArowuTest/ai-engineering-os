import Link from 'next/link';
import {
  addKnowledgeAction,
  appendMessageAction,
  changePartnerAction,
  reviseKnowledgeStatusAction,
} from '../../actions';
import { getStudio, type KnowledgeStatus, type ProductPartner } from '../../../lib/api';

export const dynamic = 'force-dynamic';

const partnerLabels: Record<ProductPartner, string> = {
  auto: 'Auto select',
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
};

const statusOptions: KnowledgeStatus[] = [
  'proposed', 'inferred', 'confirmed', 'approved', 'superseded', 'rejected',
];

const navigation = [
  'Overview', 'Requirements', 'User journeys', 'Business rules',
  'Architecture', 'Security', 'Risks', 'Decisions',
];

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function ProductStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studio = await getStudio(id);
  const missingPreview = studio.completeness.missingCategories.slice(0, 5).map(label).join(', ');

  return (
    <main className="studio-shell">
      <aside className="studio-nav">
        <div className="nav-project">
          <Link href="/">&larr; All projects</Link>
          <strong>{studio.project.name}</strong>
          <small>{label(studio.project.stage)}</small>
        </div>
        <ul>
          {navigation.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </aside>

      <section className="studio-chat" aria-label="Product discovery conversation">
        <header className="chat-header">
          <div className="chat-title">
            <strong>Product Discovery</strong>
            <small>Persistent conversation, provider-independent project state</small>
          </div>
          <form action={changePartnerAction} className="partner-form">
            <input name="projectId" type="hidden" value={id} />
            <select
              aria-label="Product Partner"
              className="select"
              defaultValue={studio.project.preferredProductPartner}
              name="preferredProductPartner"
            >
              {Object.entries(partnerLabels).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </select>
            <button className="button-small" type="submit">Switch</button>
          </form>
        </header>

        <div className="provider-notice">
          Live provider execution is intentionally not enabled in this build yet. Messages are
          being stored as durable discovery input; the next integration slice will let the selected
          Product Partner respond through the model gateway without changing this project state.
        </div>

        <div className="message-list">
          {studio.messages.length === 0 ? (
            <div className="chat-empty">
              <span className="eyebrow">Start discovery</span>
              <h2>Tell Product Studio what you want to build.</h2>
              <p>
                Your messages persist in the project. Product Knowledge remains the governed source
                of truth even when the AI partner changes.
              </p>
            </div>
          ) : (
            studio.messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                {message.content}
                <span className="message-meta">
                  {message.role}{message.provider ? ` / ${message.provider}` : ''}
                </span>
              </article>
            ))
          )}
        </div>

        <form action={appendMessageAction} className="composer">
          <input name="projectId" type="hidden" value={id} />
          <div className="composer-row">
            <textarea className="textarea" name="content" required placeholder="Describe the product, answer a discovery question, or add a decision..." />
            <button className="button" type="submit">Add</button>
          </div>
        </form>
      </section>

      <aside className="studio-knowledge" aria-label="Canonical Product Knowledge">
        <div className="knowledge-header">
          <span className="eyebrow">Canonical state</span>
          <h2>Product Knowledge</h2>
          <p>Structured, revisioned knowledge survives model changes and conversation limits.</p>
          <div className="completeness-box">
            <div className="completeness-score">
              <span>Definition coverage</span>
              <strong>{studio.completeness.percentage}%</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${studio.completeness.percentage}%` }} />
            </div>
            <div className="missing-list">
              {studio.completeness.missingCategories.length === 0
                ? 'All V1 definition areas have coverage.'
                : `Still open: ${missingPreview}${studio.completeness.missingCategories.length > 5 ? '...' : ''}`}
            </div>
          </div>
        </div>

        <details className="add-knowledge">
          <summary>Add Product Knowledge</summary>
          <form action={addKnowledgeAction} className="form-grid">
            <input name="projectId" type="hidden" value={id} />
            <div className="field">
              <label htmlFor="category">Category</label>
              <select className="select" id="category" name="category" defaultValue="vision">
                {[
                  'vision', 'objectives', 'users', 'business_model',
                  'functional_requirements', 'non_functional_requirements',
                  'business_rules', 'integrations', 'security', 'data',
                  'user_journeys', 'risks',
                ].map((category) => (
                  <option key={category} value={category}>{label(category)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="knowledge-title">Title</label>
              <input className="input" id="knowledge-title" name="title" required />
            </div>
            <div className="field">
              <label htmlFor="knowledge-content">Statement</label>
              <textarea className="textarea" id="knowledge-content" name="content" required />
            </div>
            <button className="button-small" type="submit">Add as proposed</button>
          </form>
        </details>

        <div className="knowledge-list">
          {studio.knowledge.length === 0 ? (
            <div className="empty-state">
              <h3>No structured knowledge yet</h3>
              <p>Add the first product fact or decision above.</p>
            </div>
          ) : null}
          {studio.knowledge.map((record) => (
            <article className="knowledge-card" key={record.id}>
              <div className="knowledge-card-top">
                <div>
                  <span className="knowledge-category">{label(record.category)}</span>
                  <h3>{record.title}</h3>
                </div>
                <span className={`status-pill status-${record.status}`}>{record.status}</span>
              </div>
              <p>{record.content}</p>
              <span className="knowledge-source">
                Source: {label(record.source)} / revision {record.revision}
              </span>
              <form action={reviseKnowledgeStatusAction} className="status-form">
                <input name="projectId" type="hidden" value={id} />
                <input name="knowledgeId" type="hidden" value={record.id} />
                <select className="select" defaultValue={record.status} name="status" aria-label={`Status for ${record.title}`}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{label(status)}</option>
                  ))}
                </select>
                <button className="button-small" type="submit">Update</button>
              </form>
            </article>
          ))}
        </div>
      </aside>
    </main>
  );
}
