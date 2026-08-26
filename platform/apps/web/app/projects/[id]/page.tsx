import Link from 'next/link';
import {
  acceptKnowledgeCandidateAction,
  addKnowledgeAction,
  appendMessageAction,
  changePartnerAction,
  closeRequirementsAssuranceFindingAction,
  rejectKnowledgeCandidateAction,
  retryKnowledgeExtractionAction,
  reviseKnowledgeStatusAction,
  runRequirementsAssuranceAction,
  sendProductPartnerTurnAction,
} from '../../actions';
import {
  getRequirementsAssurance,
  getStudio,
  listKnowledgeCandidates,
  listModelRoutes,
  listProjectCapabilities,
  type KnowledgeCandidateSummary,
  type KnowledgeStatus,
  type ProductPartner,
} from '../../../lib/api';
import { groupStudioModelRoutes } from '../../../lib/studio-composer';

export const dynamic = 'force-dynamic';

const partnerOptions: Array<{ value: ProductPartner; label: string }> = [
  { value: 'auto', label: 'Auto select' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'google', label: 'Gemini' },
];

const knownProviderLabels: Record<string, string> = {
  auto: 'Auto select',
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
};

function formatProviderLabel(provider: string): string {
  const known = knownProviderLabels[provider];
  if (known) return known;
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || provider;
}

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

const basisLabel: Record<string, string> = {
  user_stated: 'User stated',
  assistant_inferred: 'Assistant inferred',
  assistant_recommended: 'Assistant recommended',
};

export default async function ProductStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [studio, requirementsAssurance, modelRoutes, agents, harnesses, skills, mcpTools, workflows, candidates] = await Promise.all([
    getStudio(id),
    getRequirementsAssurance(id),
    listModelRoutes(id),
    listProjectCapabilities(id, 'agent'),
    listProjectCapabilities(id, 'harness'),
    listProjectCapabilities(id, 'skill'),
    listProjectCapabilities(id, 'mcp_tool'),
    listProjectCapabilities(id, 'workflow'),
    listKnowledgeCandidates(id).catch(() => [] as KnowledgeCandidateSummary[]),
  ]);
  // Effective role is the exact viewerProjectRole resolved server-side by resolveIdentity;
  // never inferred from organisation role or supplied by the browser.
  const viewerProjectRole = studio.viewerProjectRole;
  const canReview = viewerProjectRole === 'product_owner';
  const pendingCandidates = candidates.filter((c) => c.status === 'pending');
  const latestFailedRun = studio.latestFailedExtractionRun;
  const missingPreview = studio.completeness.missingCategories.slice(0, 5).map(label).join(', ');
  const availableRoutes = modelRoutes.filter((route) => route.available);
  const liveCapableRoutes = availableRoutes.filter(
    (route) => route.capabilities.chat && route.capabilities.structuredOutput,
  );
  const modelRouteGroups = groupStudioModelRoutes(liveCapableRoutes);
  const selectedPartner = studio.project.preferredProductPartner;
  const liveAvailable = liveCapableRoutes.length > 0 && agents.length > 0 && harnesses.length > 0;
  const selectedPartnerLabel = formatProviderLabel(selectedPartner);
  const materialAssuranceFindings = requirementsAssurance.findings.filter((finding) =>
    finding.status === 'open'
    && (finding.severity === 'critical' || finding.severity === 'important'));
  const requirementsReviewerAvailable = agents.some(
    (agent) => agent.id === 'agent.requirements_reviewer',
  ) && liveCapableRoutes.length > 0;
  const canRunRequirementsReview = requirementsReviewerAvailable
    && (viewerProjectRole === 'product_owner' || viewerProjectRole === 'contributor');
  const readinessLabel = requirementsAssurance.readiness.status === 'ready'
    ? 'Ready for engineering planning'
    : requirementsAssurance.readiness.status === 'not_ready'
      ? 'Material questions remain'
      : 'Independent review required';

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
              {partnerOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button className="button-small" type="submit">Switch</button>
          </form>
        </header>

        <div className={`provider-notice ${liveAvailable ? 'provider-live' : 'provider-offline'}`}>
          <div>
            <strong>{liveAvailable ? 'Live Product Partner ready' : `${selectedPartnerLabel} is not connected`}</strong>
            <p>
              {liveAvailable
                ? 'Your next message will run through the server-side model gateway. Project history and Product Knowledge remain platform-owned.'
                : 'Configure the selected provider on the API server or switch Product Partner. You can still save a manual discovery note below.'}
            </p>
          </div>
          <div className="provider-status-row" aria-label="Live provider connections">
            {(['openai', 'anthropic', 'google'] as const).map((provider) => {
              const route = liveCapableRoutes.find((candidate) => candidate.provider === provider);
              return (
                <span className={`provider-status ${route ? 'connected' : 'disconnected'}`} key={provider}>
                  {formatProviderLabel(provider)} <b>{route ? route.model : 'Not configured'}</b>
                </span>
              );
            })}
          </div>
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
                  {message.role}{message.provider ? ` / ${formatProviderLabel(message.provider)}` : ''}
                </span>
              </article>
            ))
          )}
        </div>

        <form action={sendProductPartnerTurnAction} className="composer">
          <input name="projectId" type="hidden" value={id} />
          <details className="composer-advanced">
            <summary>Advanced controls</summary>
            <div className="composer-governance" aria-label="Governed execution selection">
              <label>Agent
                <select className="select" name="agentId" defaultValue="auto">
                  <option value="auto">Auto</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.displayName}</option>
                  ))}
                </select>
              </label>
              <label>Model
                <select className="select" name="modelRouteId" defaultValue="auto">
                  <option value="auto">Auto</option>
                  {modelRouteGroups.map((group) => (
                    <optgroup key={group.key} label={group.label}>
                      {group.routes.map((route) => (
                        <option key={route.id} value={route.id}>
                          {formatProviderLabel(route.provider)} / {route.model}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label>Harness
                <select className="select" name="harnessId" defaultValue="auto">
                  <option value="auto">Auto</option>
                  {harnesses.map((harness) => (
                    <option key={harness.id} value={harness.id}>{harness.displayName}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <div className="composer-artifacts" aria-label="Studio multimodal inputs">
            <label>Files &amp; images
              <input
                name="artifacts"
                type="file"
                multiple
                accept="text/*,application/pdf,application/json,image/*,audio/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              />
            </label>
            <label>Screenshots
              <input name="screenshots" type="file" multiple accept="image/*" />
            </label>
            <label>Voice / microphone
              <input name="voice" type="file" accept="audio/*" capture="user" />
            </label>
          </div>
          <div className="composer-row">
            <textarea
              className="textarea"
              disabled={!liveAvailable}
              name="content"
              required
              placeholder={liveAvailable
                ? `Message ${selectedPartnerLabel} about the product...`
                : `Connect ${selectedPartnerLabel} or switch Product Partner to send a live turn.`}
            />
            <button className="button" disabled={!liveAvailable} type="submit">
              {liveAvailable ? 'Send' : 'Provider offline'}
            </button>
          </div>
        </form>

        <details className="manual-note">
          <summary>Save a manual discovery note instead</summary>
          <form action={appendMessageAction} className="manual-note-form">
            <input name="projectId" type="hidden" value={id} />
            <textarea
              className="textarea"
              name="content"
              required
              placeholder="Store a note without calling an AI provider..."
            />
            <button className="button-small" type="submit">Save note</button>
          </form>
        </details>
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

        <section className="project-capabilities" aria-label="Project capabilities">
          <div className="review-queue-header">
            <span className="eyebrow">Governed capability directory</span>
            <h3>Project capabilities</h3>
            <p>Only capabilities released and eligible for this project are shown here. Discovery alone never grants use.</p>
          </div>
          <div className="capability-directory-grid">
            <div>
              <strong>Agents</strong>
              <p>{agents.length > 0 ? agents.map((item) => item.displayName).join(', ') : 'No eligible agents'}</p>
            </div>
            <div>
              <strong>Skills</strong>
              <p>{skills.length > 0 ? skills.map((item) => item.displayName).join(', ') : 'No eligible skills'}</p>
            </div>
            <div>
              <strong>MCP &amp; tools</strong>
              <p>{mcpTools.length > 0 ? mcpTools.map((item) => item.displayName).join(', ') : 'No eligible MCP/tools'}</p>
            </div>
            <div>
              <strong>Workflows</strong>
              <p>{workflows.length > 0 ? workflows.map((item) => item.displayName).join(', ') : 'No eligible workflows'}</p>
            </div>
            <div>
              <strong>Connectors &amp; model access</strong>
              <p><Link href="/ai-connections">Manage AI Connections</Link></p>
            </div>
          </div>
        </section>
        <section className="requirements-assurance" aria-label="Requirements Assurance">
          <div className="review-queue-header">
            <span className="eyebrow">Independent challenge</span>
            <h3>Requirements Readiness</h3>
            <p className="review-queue-status">
              {readinessLabel} ({requirementsAssurance.readiness.status})
            </p>
            <p>
              Requirements Assurance findings are non-canonical review evidence. They identify gaps,
              edge cases and questions for the Product Partner and user; they do not become approved
              Product Knowledge unless separately resolved through the governed knowledge flow.
            </p>
            {requirementsAssurance.run ? (
              <small>
                Latest review <code>{requirementsAssurance.run.id}</code> via route{' '}
                <code>{requirementsAssurance.run.reviewerRouteId}</code> / status{' '}
                <code>{requirementsAssurance.run.status}</code>
              </small>
            ) : null}
          </div>

          <form action={runRequirementsAssuranceAction} className="partner-form">
            <input name="projectId" type="hidden" value={id} />
            <label>Reviewer model
              <select className="select" name="reviewerRouteId" defaultValue="auto">
                <option value="auto">Auto</option>
                {liveCapableRoutes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {formatProviderLabel(route.provider)} / {route.model}
                  </option>
                ))}
              </select>
            </label>
            <button className="button-small" disabled={!canRunRequirementsReview} type="submit">
              Run Requirements Review
            </button>
          </form>

          {!requirementsReviewerAvailable ? (
            <p className="review-queue-readonly">
              No governed Requirements Reviewer agent/model route is currently eligible for this project.
            </p>
          ) : null}

          <div className="review-queue-list">
            {materialAssuranceFindings.length === 0 ? (
              <p className="review-queue-status">
                {requirementsAssurance.readiness.status === 'ready'
                  ? 'No open material reviewer findings on the current exact requirements state.'
                  : 'No current material findings are available; run a fresh independent review.'}
              </p>
            ) : null}
            {materialAssuranceFindings.map((finding) => (
              <article className="review-card" key={finding.id}>
                <div className="review-card-top">
                  <div>
                    <span className="knowledge-category">{label(finding.category)}</span>
                    <h4>{finding.summary}</h4>
                  </div>
                  <span className="status-pill">{finding.severity}</span>
                </div>
                <p>{finding.rationale}</p>
                {finding.proposedQuestion ? (
                  <p><strong>Question to resolve:</strong> {finding.proposedQuestion}</p>
                ) : null}
                {finding.suggestedDirection ? (
                  <p><strong>Reviewer suggestion:</strong> {finding.suggestedDirection}</p>
                ) : null}
                <small>
                  Basis: {label(finding.basis)} / {label(finding.kind)} / finding <code>{finding.id}</code>
                </small>
                {canReview ? (
                  <form action={closeRequirementsAssuranceFindingAction} className="review-reject-form">
                    <input name="projectId" type="hidden" value={id} />
                    <input name="findingId" type="hidden" value={finding.id} />
                    <label>
                      Resolution note
                      <input
                        aria-label={`Resolution note for ${finding.summary}`}
                        className="input"
                        name="resolutionNote"
                        placeholder="Explain how this was resolved or why it does not apply"
                        required
                      />
                    </label>
                    <div className="review-card-actions">
                      <button className="button-small" name="status" type="submit" value="resolved">
                        Mark resolved
                      </button>
                      <button className="button-small" name="status" type="submit" value="dismissed">
                        Not applicable
                      </button>
                    </div>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="review-queue" aria-label="Product Knowledge Review Queue">
          <div className="review-queue-header">
            <span className="eyebrow">Review Queue</span>
            <h3>Product Knowledge candidates</h3>
            <p className="review-queue-status">
              {pendingCandidates.length > 0
                ? `${pendingCandidates.length} candidates ready for review`
                : 'No new candidates'}
            </p>
            {!canReview ? (
              <p className="review-queue-readonly">
                Read-only view. Only Product Owners can accept, reject or retry extraction.
              </p>
            ) : null}
          </div>

          {latestFailedRun ? (
            <div className="review-queue-alert">
              <strong>Knowledge extraction failed &mdash; retry available</strong>
              <p>
                The assistant answer above was saved, but structured Product Knowledge extraction did not
                complete. Last attempt via {formatProviderLabel(latestFailedRun.provider)}{' '}
                <code>{latestFailedRun.model}</code> (route <code>{latestFailedRun.routeId}</code>).{' '}
                {canReview
                  ? 'Retry to re-run candidate extraction from the persisted source turn.'
                  : 'A Product Owner can retry from this project.'}
              </p>
              {canReview ? (
                <form action={retryKnowledgeExtractionAction}>
                  <input name="projectId" type="hidden" value={id} />
                  <input name="runId" type="hidden" value={latestFailedRun.id} />
                  <button className="button-small" type="submit">Retry extraction</button>
                </form>
              ) : null}
            </div>
          ) : null}

          <div className="review-queue-list">
            {pendingCandidates.map((candidate) => (
              <article className="review-card" key={candidate.id}>
                <div className="review-card-top">
                  <div>
                    <span className="knowledge-category">{label(candidate.category)}</span>
                    <h4>{candidate.title}</h4>
                  </div>
                  <span className={`status-pill status-${candidate.status}`}>{candidate.status}</span>
                </div>
                <p>{candidate.content}</p>
                <dl className="review-card-provenance">
                  <div>
                    <dt>Basis</dt>
                    <dd>{basisLabel[candidate.basis] ?? candidate.basis}</dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{formatProviderLabel(candidate.sourceRun.provider)}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd><code>{candidate.sourceRun.model}</code></dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd><code>{candidate.sourceRun.routeId}</code></dd>
                  </div>
                  <div>
                    <dt>Source run</dt>
                    <dd><code>{candidate.sourceRun.id}</code></dd>
                  </div>
                </dl>

                {canReview ? (
                  <div className="review-card-actions">
                    <form action={acceptKnowledgeCandidateAction} className="review-accept-form">
                      <input name="projectId" type="hidden" value={id} />
                      <input name="candidateId" type="hidden" value={candidate.id} />
                      <details>
                        <summary>Edit &amp; Accept</summary>
                        <div className="field">
                          <label htmlFor={`edit-category-${candidate.id}`}>Category</label>
                          <input
                            className="input"
                            id={`edit-category-${candidate.id}`}
                            name="category"
                            defaultValue={candidate.category}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-title-${candidate.id}`}>Title</label>
                          <input
                            className="input"
                            id={`edit-title-${candidate.id}`}
                            name="title"
                            defaultValue={candidate.title}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-content-${candidate.id}`}>Statement</label>
                          <textarea
                            className="textarea"
                            id={`edit-content-${candidate.id}`}
                            name="content"
                            defaultValue={candidate.content}
                            required
                          />
                        </div>
                      </details>
                      <button className="button-small" type="submit">Accept</button>
                    </form>
                    <form action={rejectKnowledgeCandidateAction} className="review-reject-form">
                      <input name="projectId" type="hidden" value={id} />
                      <input name="candidateId" type="hidden" value={candidate.id} />
                      <input
                        aria-label="Rejection reason"
                        className="input"
                        name="reason"
                        placeholder="Optional reason"
                      />
                      <button className="button-small button-danger" type="submit">Reject</button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

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
