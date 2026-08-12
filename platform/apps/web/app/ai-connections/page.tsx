import {
  getCurrentIdentity,
  listAIConnectionFamilies,
  listAIConnections,
  listProjectAIExecutionPool,
  listProjects,
  ORGANISATION_COOKIE,
  type AIConnectionSummary,
  type ProjectExecutionPool,
  type SafeConnectionFamilyPolicy,
} from '../../lib/api';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  clearAIConnectionShareWindowAction,
  registerOrganisationAIConnectionAction,
  registerPersonalAIConnectionAction,
  revokeAIConnectionAction,
  revokeAIConnectionShareAction,
  setAIConnectionShareModeAction,
  shareAIConnectionAction,
  updateAIConnectionShareWindowAction,
} from '../actions';

export const dynamic = 'force-dynamic';

const reasonLabels: Record<string, string> = {
  connection_unavailable: 'Connection unavailable',
  policy_not_delegatable: 'Policy does not allow delegation',
  owner_offline: 'Owner offline',
  runner_unavailable: 'Runner unavailable',
  usage_window_not_started: 'Usage window not started',
  usage_window_expired: 'Usage window expired',
  persistent_not_supported: 'Persistent sharing not supported',
};

function familyDisplay(
  families: SafeConnectionFamilyPolicy[],
  familyId: string,
): SafeConnectionFamilyPolicy | undefined {
  return families.find((family) => family.id === familyId);
}

function toDatetimeLocal(iso: string | undefined): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  // Render in UTC and strip the seconds/ms + trailing Z for datetime-local.
  return parsed.toISOString().slice(0, 16);
}

export default async function AIConnectionsPage() {
  const identity = await getCurrentIdentity();
  if (!identity) redirect('/login');
  const cookieStore = await cookies();
  const activeOrganisationId =
    cookieStore.get(ORGANISATION_COOKIE)?.value ?? identity.organisations[0]?.organisationId;
  const organisationRole =
    identity.organisations.find((entry) => entry.organisationId === activeOrganisationId)?.role ??
    null;
  const canRegisterOrganisationConnection =
    organisationRole === 'owner' || organisationRole === 'admin';

  const [families, connections, projects] = await Promise.all([
    listAIConnectionFamilies(),
    listAIConnections(),
    listProjects(),
  ]);

  const personalConnections: AIConnectionSummary[] = connections.filter(
    (connection) => connection.ownership === 'personal',
  );
  const organisationConnections: AIConnectionSummary[] = connections.filter(
    (connection) => connection.ownership === 'organisation',
  );

  const personalFamilies = families.filter((family) =>
    family.allowedOwnership.includes('personal'),
  );
  const organisationFamilies = families.filter((family) =>
    family.allowedOwnership.includes('organisation'),
  );

  const projectPools: Array<{
    projectId: string;
    projectName: string;
    pool: ProjectExecutionPool;
  }> = await Promise.all(
    projects.map(async (project) => ({
      projectId: project.id,
      projectName: project.name,
      pool: await listProjectAIExecutionPool(project.id),
    })),
  );

  return (
    <main className="page-shell ai-connections">
      <div className="page-heading">
        <div>
          <span className="eyebrow">AI Connections</span>
          <h1>Manage the AI connections available to your work.</h1>
          <p className="lead">
            Personal connections belong to you. Organisation connections are governed centrally.
            Project sharing exposes eligible pooled connections to a specific product.
          </p>
        </div>
      </div>

      <section className="ai-connection-panel">
        <div className="panel-heading">
          <div>
            <h2>Personal Connections</h2>
            <p>Register a connection tied to your account. No credential is entered here.</p>
          </div>
        </div>

        <form action={registerPersonalAIConnectionAction} className="inline-form">
          <label>
            <span>Family</span>
            <select className="select" name="connectionFamilyId" required defaultValue="">
              <option value="" disabled>
                Select a connection family
              </option>
              {personalFamilies.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.displayName}
                </option>
              ))}
            </select>
          </label>
          <button className="button-small" type="submit">
            Register personal connection
          </button>
        </form>

        <div className="ai-connection-list">
          {personalConnections.length === 0 ? (
            <p className="empty-inline">No personal connections yet.</p>
          ) : (
            personalConnections.map((connection) => {
              const family = familyDisplay(families, connection.connectionFamilyId);
              return (
                <article className="ai-connection-card" key={connection.id}>
                  <div>
                    <strong>{family?.displayName ?? connection.connectionFamilyId}</strong>
                    <span>
                      {connection.providerId} · {connection.status}
                    </span>
                    <small>
                      Credential configured:{' '}
                      {connection.credentialConfigured ? 'yes' : 'no'}
                    </small>
                  </div>
                  <form action={revokeAIConnectionAction}>
                    <input type="hidden" name="connectionId" value={connection.id} />
                    <button className="button-danger" type="submit">
                      Revoke
                    </button>
                  </form>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="ai-connection-panel">
        <div className="panel-heading">
          <div>
            <h2>Organisation Connections</h2>
            <p>Governed centrally by organisation owners and admins.</p>
          </div>
        </div>

        {canRegisterOrganisationConnection ? (
          <form action={registerOrganisationAIConnectionAction} className="inline-form">
            <label>
              <span>Family</span>
              <select className="select" name="connectionFamilyId" required defaultValue="">
                <option value="" disabled>
                  Select a connection family
                </option>
                {organisationFamilies.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>External secret-reference identifier (optional)</span>
              <input
                className="input"
                name="secretRefId"
                type="text"
                placeholder="Reference id resolved by the runtime — not the secret itself"
                autoComplete="off"
              />
            </label>
            <button className="button-small" type="submit">
              Register organisation connection
            </button>
          </form>
        ) : (
          <p className="empty-inline">
            Only organisation owners or admins can register organisation connections.
          </p>
        )}

        <div className="ai-connection-list">
          {organisationConnections.length === 0 ? (
            <p className="empty-inline">No organisation connections yet.</p>
          ) : (
            organisationConnections.map((connection) => {
              const family = familyDisplay(families, connection.connectionFamilyId);
              return (
                <article className="ai-connection-card" key={connection.id}>
                  <div>
                    <strong>{family?.displayName ?? connection.connectionFamilyId}</strong>
                    <span>
                      {connection.providerId} · {connection.status}
                    </span>
                    <small>
                      Credential configured:{' '}
                      {connection.credentialConfigured ? 'yes' : 'no'}
                    </small>
                  </div>
                  {canRegisterOrganisationConnection ? (
                    <form action={revokeAIConnectionAction}>
                      <input type="hidden" name="connectionId" value={connection.id} />
                      <button className="button-danger" type="submit">
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="ai-connection-panel">
        <div className="panel-heading">
          <div>
            <h2>Project Sharing</h2>
            <p>
              Share personal connections with a project pool. Persistent sharing is a separate
              switch and only enabled when the connection family policy permits it.
            </p>
          </div>
        </div>

        {projectPools.length === 0 ? (
          <p className="empty-inline">You have no projects to share connections with.</p>
        ) : (
          projectPools.map(({ projectId, projectName, pool }) => (
            <div className="ai-connection-project" key={projectId}>
              <h3>{projectName}</h3>

              <div className="ai-connection-share-controls">
                {personalConnections.length === 0 ? (
                  <p className="empty-inline">
                    Register a personal connection first before sharing.
                  </p>
                ) : (
                  personalConnections.map((connection) => {
                    const family = familyDisplay(families, connection.connectionFamilyId);
                    const persistentSupported = family?.persistentSupported === true;
                    // Owner-side share state comes from the authoritative requester-tier entry
                    // (backend hydrates entry.share for owner-owned shares). We never infer
                    // ownership from `tier === 'project_pool'` — that tier is for OTHER users'
                    // contributed shares.
                    const ownerEntry = pool.entries.find(
                      (entry) =>
                        entry.tier === 'requester' && entry.connectionId === connection.id,
                    );
                    const activeShare = ownerEntry?.share;
                    return (
                      <article
                        className="ai-connection-card"
                        key={`${projectId}:${connection.id}`}
                      >
                        <div>
                          <strong>{family?.displayName ?? connection.connectionFamilyId}</strong>
                          <span>{connection.providerId}</span>
                          {activeShare ? (
                            <small>
                              Active share · {activeShare.mode}
                            </small>
                          ) : (
                            <small>Not shared with this project</small>
                          )}
                        </div>

                        {!activeShare ? (
                          <form
                            action={shareAIConnectionAction}
                            className="inline-form"
                          >
                            <input type="hidden" name="projectId" value={projectId} />
                            <input
                              type="hidden"
                              name="connectionId"
                              value={connection.id}
                            />
                            <button className="button-small" type="submit">
                              Share as Online Only
                            </button>
                          </form>
                        ) : (
                          <div className="ai-connection-actions">
                            {persistentSupported &&
                            activeShare.mode !== 'persistent' ? (
                              <form action={setAIConnectionShareModeAction}>
                                <input
                                  type="hidden"
                                  name="projectId"
                                  value={projectId}
                                />
                                <input
                                  type="hidden"
                                  name="connectionId"
                                  value={connection.id}
                                />
                                <input
                                  type="hidden"
                                  name="mode"
                                  value="persistent"
                                />
                                <button className="button-small" type="submit">
                                  Switch to Persistent
                                </button>
                              </form>
                            ) : null}
                            {activeShare.mode === 'persistent' ? (
                              <form action={setAIConnectionShareModeAction}>
                                <input
                                  type="hidden"
                                  name="projectId"
                                  value={projectId}
                                />
                                <input
                                  type="hidden"
                                  name="connectionId"
                                  value={connection.id}
                                />
                                <input
                                  type="hidden"
                                  name="mode"
                                  value="online_only"
                                />
                                <button className="button-small" type="submit">
                                  Switch to Online Only
                                </button>
                              </form>
                            ) : null}
                            <form
                              action={updateAIConnectionShareWindowAction}
                              className="inline-form"
                            >
                              <input
                                type="hidden"
                                name="projectId"
                                value={projectId}
                              />
                              <input
                                type="hidden"
                                name="connectionId"
                                value={connection.id}
                              />
                              <label>
                                <span>Available from (UTC)</span>
                                <input
                                  className="input"
                                  type="datetime-local"
                                  name="availableFrom"
                                  defaultValue={toDatetimeLocal(
                                    activeShare.availableFrom,
                                  )}
                                />
                              </label>
                              <label>
                                <span>Available until (UTC)</span>
                                <input
                                  className="input"
                                  type="datetime-local"
                                  name="availableUntil"
                                  defaultValue={toDatetimeLocal(
                                    activeShare.availableUntil,
                                  )}
                                />
                              </label>
                              <button className="button-small" type="submit">
                                Update usage window
                              </button>
                            </form>
                            <form action={clearAIConnectionShareWindowAction}>
                              <input
                                type="hidden"
                                name="projectId"
                                value={projectId}
                              />
                              <input
                                type="hidden"
                                name="connectionId"
                                value={connection.id}
                              />
                              <button className="button-small" type="submit">
                                Clear usage window
                              </button>
                            </form>
                            <form action={revokeAIConnectionShareAction}>
                              <input
                                type="hidden"
                                name="projectId"
                                value={projectId}
                              />
                              <input
                                type="hidden"
                                name="connectionId"
                                value={connection.id}
                              />
                              <button className="button-danger" type="submit">
                                Revoke share
                              </button>
                            </form>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>

              <div className="ai-connection-pool">
                <h4>Execution pool</h4>
                {pool.entries.length === 0 ? (
                  <p className="empty-inline">No pool entries yet.</p>
                ) : (
                  <ul className="ai-connection-pool-list">
                    {pool.entries.map((entry) => (
                      <li className="ai-connection-pool-entry" key={entry.connectionId}>
                        <div>
                          <strong>{entry.providerId}</strong>
                          <span>
                            {entry.tier} · {entry.connectionFamilyId}
                            {entry.shareMode ? ` · ${entry.shareMode}` : ''}
                          </span>
                        </div>
                        <div>
                          {entry.eligible ? (
                            <span className="badge badge-success">Eligible</span>
                          ) : (
                            <span className="badge badge-warning">
                              Ineligible:{' '}
                              {entry.reasons
                                .map((reason) => reasonLabels[reason] ?? reason)
                                .join(', ')}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
