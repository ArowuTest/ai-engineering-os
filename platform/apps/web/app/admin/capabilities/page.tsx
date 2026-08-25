import {
  changeCapabilityGovernanceStateAction,
  createCapabilityEligibilityAction,
  createCapabilityReleaseAction,
  grantCapabilityPopulationMembershipAction,
  refreshCapabilityEstateAction,
  revokeCapabilityEligibilityAction,
  revokeCapabilityPopulationMembershipAction,
  revokeCapabilityReleaseAction,
} from '../../actions';
import { getCapabilityEstateSnapshot } from '../../../lib/api';

export const dynamic = 'force-dynamic';

function scopeLabel(policy: {
  scope: string; organisationId?: string; projectId?: string; projectRole?: string;
  teamId?: string; cohortId?: string; userId?: string;
}) {
  const target = policy.projectId ?? policy.projectRole ?? policy.teamId
    ?? policy.cohortId ?? policy.userId ?? policy.organisationId;
  return target ? `${policy.scope}: ${target}` : policy.scope;
}

export default async function CapabilityEstateAdministrationPage() {
  const estate = await getCapabilityEstateSnapshot();
  const activeReleases = estate.releases.filter((item) => item.status === 'active');
  const activeEligibility = estate.eligibilityPolicies.filter((item) => item.status === 'active');

  return (
    <main className="page-shell access-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Platform administration</span>
          <h1>Capability Estate</h1>
          <p className="lead">
            Govern discovery, verification and release independently. New ECC capability never auto-releases.
          </p>
        </div>
        <form action={refreshCapabilityEstateAction}>
          <button className="button" type="submit">Refresh ECC</button>
        </form>
      </div>

      <section className="access-panel access-wide">
        <div className="panel-heading">
          <div>
            <h2>Governed catalogue</h2>
            <p>{estate.capabilities.length} capabilities · {activeReleases.length} active releases · {activeEligibility.length} active eligibility policies</p>
          </div>
        </div>
        <div className="people-list">
          {estate.capabilities.map((capability) => {
            const releases = activeReleases.filter((item) => item.capabilityId === capability.id);
            const eligibilityPolicies = activeEligibility.filter((item) => item.capabilityId === capability.id);
            return (
              <article className="person-card" key={capability.id}>
                <div className="person-main">
                  <div>
                    <strong>{capability.displayName}</strong>
                    <span>{capability.kind} · {capability.source}</span>
                    <small>{capability.id} · {capability.sourceRef}</small>
                  </div>
                  <div>
                    <strong>{capability.governanceState}</strong>
                    <span>{capability.maturity} · {capability.executionVerification}</span>
                  </div>
                </div>
                <form action={changeCapabilityGovernanceStateAction} className="inline-form">
                  <input name="capabilityId" type="hidden" value={capability.id} />
                  <select className="select" name="governanceState" defaultValue={capability.governanceState}>
                    <option value="discovered">Discovered</option>
                    <option value="trial_calibration">Trial calibration</option>
                    <option value="approved">Approved</option>
                    <option value="disabled">Disabled</option>
                  </select>
                  <button className="button-small" type="submit">Update governance</button>
                </form>

                <div className="project-access-list">
                  <strong>Releases</strong>
                  {releases.length === 0 ? <span className="empty-inline">No active release.</span> : releases.map((release) => (
                    <div className="project-access-row" key={release.id}>
                      <span>{scopeLabel(release)}</span>
                      <form action={revokeCapabilityReleaseAction}>
                        <input name="capabilityId" type="hidden" value={capability.id} />
                        <input name="releaseId" type="hidden" value={release.id} />
                        <input name="platformScoped" type="hidden" value={release.scope === 'platform' ? 'true' : 'false'} />
                        {release.organisationId ? (
                          <input name="organisationId" type="hidden" value={release.organisationId} />
                        ) : null}
                        <button className="link-button danger-text" type="submit">Revoke</button>
                      </form>
                    </div>
                  ))}
                </div>

                <form action={createCapabilityReleaseAction} className="inline-form">
                  <input name="capabilityId" type="hidden" value={capability.id} />
                  <input name="scope" type="hidden" value="platform" />
                  <button className="button-small" type="submit">Release platform-wide</button>
                </form>
                <form action={createCapabilityReleaseAction} className="inline-form">
                  <input name="capabilityId" type="hidden" value={capability.id} />
                  <input name="scope" type="hidden" value="organisation" />
                  <input aria-label="Target organisation for release" className="input" name="organisationId" placeholder="Organisation ID" required />
                  <button className="button-small" type="submit">Release to organisation</button>
                </form>
                <div className="project-access-list">
                  <strong>Eligibility policies</strong>
                  {eligibilityPolicies.length === 0 ? (
                    <span className="empty-inline">No active eligibility override.</span>
                  ) : eligibilityPolicies.map((policy) => (
                    <div className="project-access-row" key={policy.id}>
                      <span>{scopeLabel(policy)}</span>
                      <strong>{policy.decision}</strong>
                      <small>{policy.organisationId}</small>
                      <form action={revokeCapabilityEligibilityAction}>
                        <input name="capabilityId" type="hidden" value={capability.id} />
                        <input name="policyId" type="hidden" value={policy.id} />
                        <input name="organisationId" type="hidden" value={policy.organisationId} />
                        <button className="link-button danger-text" type="submit">Revoke</button>
                      </form>
                    </div>
                  ))}
                </div>
                <form action={createCapabilityEligibilityAction} className="inline-form">
                  <input name="capabilityId" type="hidden" value={capability.id} />
                  <input name="scope" type="hidden" value="organisation" />
                  <input aria-label="Target organisation for eligibility" className="input" name="organisationId" placeholder="Organisation ID" required />
                  <select aria-label="Eligibility decision" className="select" name="decision" defaultValue="allow">
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                  <button className="button-small" type="submit">Add organisation policy</button>
                </form>
              </article>
            );
          })}
        </div>
      </section>

      <section className="access-panel access-wide" aria-label="Capability population administration">
        <div className="panel-heading">
          <div>
            <h2>Teams and cohorts</h2>
            <p>Manage organisation-scoped eligibility populations without changing organisation membership or project roles.</p>
          </div>
        </div>
        <form action={grantCapabilityPopulationMembershipAction} className="inline-form">
          <input aria-label="Population organisation" className="input" name="organisationId" placeholder="Organisation ID" required />
          <select aria-label="Population kind" className="select" name="kind" defaultValue="team">
            <option value="team">Team</option>
            <option value="cohort">Cohort</option>
          </select>
          <input aria-label="Population ID" className="input" name="populationId" placeholder="Team or cohort ID" required />
          <input aria-label="Population user ID" className="input" name="userId" placeholder="User ID" required />
          <button className="button-small" type="submit">Add member</button>
        </form>
        <form action={revokeCapabilityPopulationMembershipAction} className="inline-form">
          <input aria-label="Population organisation to revoke" className="input" name="organisationId" placeholder="Organisation ID" required />
          <select aria-label="Population kind to revoke" className="select" name="kind" defaultValue="team">
            <option value="team">Team</option>
            <option value="cohort">Cohort</option>
          </select>
          <input aria-label="Population ID to revoke" className="input" name="populationId" placeholder="Team or cohort ID" required />
          <input aria-label="Population user ID to revoke" className="input" name="userId" placeholder="User ID" required />
          <button className="button-small" type="submit">Remove member</button>
        </form>
      </section>
    </main>
  );
}
