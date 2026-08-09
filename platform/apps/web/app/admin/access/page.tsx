import { cookies } from 'next/headers';
import {
  cancelInvitationAction,
  createInvitationAction,
  grantProjectAccessAction,

  revokeOrganisationAccessAction,
  revokeProjectAccessAction,
  setUserStatusAction,
  updateInvitationPolicyAction,
} from '../../actions';
import {
  getInvitationPolicy,
  INVITATION_FLASH_COOKIE,
  listInvitations,
  listPeople,
  listProjects,
  type ProjectRole,
} from '../../../lib/api';

export const dynamic = 'force-dynamic';

const projectRoleLabels: Record<ProjectRole, string> = {
  product_owner: 'Product Owner',
  contributor: 'Contributor',
  engineer: 'Engineer',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};

export default async function AccessAdministrationPage() {
  const [people, projects, policy, invitations] = await Promise.all([
    listPeople(), listProjects(), getInvitationPolicy(), listInvitations(),
  ]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const cookieStore = await cookies();
  const flash = cookieStore.get(INVITATION_FLASH_COOKIE)?.value;
  let createdKey: { key: string; expiresAt: string } | null = null;
  if (flash) {
    try { createdKey = JSON.parse(flash) as { key: string; expiresAt: string }; } catch { createdKey = null; }
  }

  return (
    <main className="page-shell access-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">People & access</span>
          <h1>Control who can work on each product.</h1>
          <p className="lead">Invitation keys are single-use. Account and project permissions are evaluated on every protected request.</p>
        </div>
      </div>

      {createdKey ? (
        <section className="access-alert">
          <div>
            <strong>Copy this invitation key now</strong>
            <p>It will not be stored in retrievable plaintext by the platform.</p>
          </div>
          <code>{createdKey.key}</code>
          <small>Expires {new Date(createdKey.expiresAt).toLocaleString()}</small>
        </section>
      ) : null}

      <section className="access-grid">
        <div className="access-panel">
          <h2>Invitation policy</h2>
          <p>Default expiry for newly generated invitation keys.</p>
          <form action={updateInvitationPolicyAction} className="inline-form">
            <input className="input" type="number" min="1" name="ttlMinutes" defaultValue={policy.ttlMinutes} required />
            <span>minutes</span>
            <button className="button-small" type="submit">Save</button>
          </form>
        </div>

        <div className="access-panel">
          <h2>Generate invitation</h2>
          <form action={createInvitationAction} className="form-grid">
            <div className="field">
              <label>Organisation role</label>
              <select className="select" name="organisationRole" defaultValue="member">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div className="field">
              <label>Expires in</label>
              <input className="input" type="number" min="1" name="ttlMinutes" defaultValue={policy.ttlMinutes} required />
            </div>
            <div className="field">
              <label>Project role for selected projects</label>
              <select className="select" name="projectRole" defaultValue="contributor">
                {Object.entries(projectRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="project-checklist">
              {projects.map((project) => (
                <label key={project.id}><input type="checkbox" name="projectId" value={project.id} /> {project.name}</label>
              ))}
            </div>
            <button className="button" type="submit">Generate one-time key</button>
          </form>
        </div>
      </section>

      <section className="access-panel access-wide">
        <div className="panel-heading">
          <div>
            <h2>People</h2>
            <p>Organisation membership and project access are independent controls.</p>
          </div>
          <strong>{people.length} users</strong>
        </div>
        <div className="people-list">
          {people.map((person) => (
            <article className="person-card" key={person.id}>
              <div className="person-main">
                <div>
                  <strong>{person.userId}</strong>
                  <span>{person.organisationRole} · {person.accountStatus}</span>
                </div>
                <div className="person-actions">
                  <form action={setUserStatusAction}>
                    <input type="hidden" name="userId" value={person.id} />
                    <input type="hidden" name="status" value={person.accountStatus === 'active' ? 'suspended' : 'active'} />
                    <button className="button-secondary" type="submit">{person.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}</button>
                  </form>
                  {person.organisationRole !== 'owner' ? (
                    <form action={revokeOrganisationAccessAction}>
                      <input type="hidden" name="userId" value={person.id} />
                      <button className="button-danger" type="submit">Remove from organisation</button>
                    </form>
                  ) : null}
                </div>
              </div>

              <div className="project-access-list">
                {person.projects.length === 0 ? <span className="empty-inline">No explicit project access</span> : person.projects.map((grant) => (
                  <div className="project-access-row" key={grant.projectId}>
                    <span>{projectNames.get(grant.projectId) ?? grant.projectId}</span>
                    <strong>{projectRoleLabels[grant.role]}</strong>
                    <form action={revokeProjectAccessAction}>
                      <input type="hidden" name="projectId" value={grant.projectId} />
                      <input type="hidden" name="userId" value={person.id} />
                      <button className="link-button danger-text" type="submit">Remove</button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={grantProjectAccessAction} className="inline-form access-grant-form">
                <input type="hidden" name="userId" value={person.id} />
                <select className="select" name="projectId" required defaultValue="">
                  <option value="" disabled>Select project</option>
                  {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                </select>
                <select className="select" name="role" defaultValue="viewer">
                  {Object.entries(projectRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button className="button-small" type="submit">Grant / change</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="access-panel access-wide">
        <div className="panel-heading">
          <div>
            <h2>Invitations</h2>
            <p>Only pending invitations can still be used.</p>
          </div>
        </div>
        <div className="invitation-list">
          {invitations.length === 0 ? <p className="empty-inline">No invitations yet.</p> : invitations.map((invitation) => (
            <div className="invitation-row" key={invitation.id}>
              <div>
                <strong>{invitation.organisationRole}</strong>
                <span>{invitation.status} · expires {new Date(invitation.expiresAt).toLocaleString()}</span>
                <small>{invitation.projectGrants.length} project grant{invitation.projectGrants.length === 1 ? '' : 's'}</small>
              </div>
              {invitation.status === 'pending' ? (
                <form action={cancelInvitationAction}>
                  <input type="hidden" name="invitationId" value={invitation.id} />
                  <button className="button-secondary" type="submit">Cancel invitation</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
