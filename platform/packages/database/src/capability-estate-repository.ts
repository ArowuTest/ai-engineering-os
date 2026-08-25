import type {
  AgentRecord,
  CapabilityEligibilityPolicy,
  CapabilityKind,
  CapabilityRecord,
  CapabilityReleasePolicy,
} from '@engineering-os/domain';
import type { DatabaseQueryable } from './queryable.js';

interface CapabilityRow {
  id: string;
  kind: CapabilityKind;
  source: string;
  source_ref: string;
  display_name: string;
  maturity: CapabilityRecord['maturity'];
  governance_state: CapabilityRecord['governanceState'];
  execution_verification: CapabilityRecord['executionVerification'];
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface ReleaseRow {
  id: string;
  capability_id: string;
  scope: CapabilityReleasePolicy['scope'];
  organisation_id: string | null;
  project_id: string | null;
  project_role: string | null;
  team_id: string | null;
  cohort_id: string | null;
  user_id: string | null;  status: CapabilityReleasePolicy['status'];
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
}

interface EligibilityRow {
  id: string;
  capability_id: string;
  scope: CapabilityEligibilityPolicy['scope'];
  organisation_id: string;
  project_id: string | null;
  project_role: string | null;
  team_id: string | null;
  cohort_id: string | null;
  user_id: string | null;
  decision: CapabilityEligibilityPolicy['decision'];
  status: CapabilityEligibilityPolicy['status'];
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
}
interface AgentRow {
  id: string;
  capability_id: string;
  display_name: string;
  specialist_role: string;
  description: string;
  status: AgentRecord['status'];
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const CAPABILITY_COLUMNS = `
  id, kind, source, source_ref, display_name, maturity, governance_state,
  execution_verification, created_by, created_at, updated_at`;

const RELEASE_COLUMNS = `
  id, capability_id, scope, organisation_id, project_id, project_role,
  team_id, cohort_id, user_id, status, created_by, created_at, revoked_at`;

const ELIGIBILITY_COLUMNS = `
  id, capability_id, scope, organisation_id, project_id, project_role,
  team_id, cohort_id, user_id, decision, status, created_by, created_at, revoked_at`;
const AGENT_COLUMNS = `
  id, capability_id, display_name, specialist_role, description, status,
  created_by, created_at, updated_at`;
function mapCapability(row: CapabilityRow): CapabilityRecord {
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    sourceRef: row.source_ref,
    displayName: row.display_name,
    maturity: row.maturity,
    governanceState: row.governance_state,
    executionVerification: row.execution_verification,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRelease(row: ReleaseRow): CapabilityReleasePolicy {
  const record: CapabilityReleasePolicy = {
    id: row.id,
    capabilityId: row.capability_id,
    scope: row.scope,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
  if (row.organisation_id !== null) record.organisationId = row.organisation_id;
  if (row.project_id !== null) record.projectId = row.project_id;
  if (row.project_role !== null) record.projectRole = row.project_role;
  if (row.team_id !== null) record.teamId = row.team_id;
  if (row.cohort_id !== null) record.cohortId = row.cohort_id;  if (row.user_id !== null) record.userId = row.user_id;
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}

function mapEligibility(row: EligibilityRow): CapabilityEligibilityPolicy {
  const record: CapabilityEligibilityPolicy = {
    id: row.id,
    capabilityId: row.capability_id,
    scope: row.scope,
    organisationId: row.organisation_id,
    decision: row.decision,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
  if (row.project_id !== null) record.projectId = row.project_id;
  if (row.project_role !== null) record.projectRole = row.project_role;
  if (row.team_id !== null) record.teamId = row.team_id;
  if (row.cohort_id !== null) record.cohortId = row.cohort_id;
  if (row.user_id !== null) record.userId = row.user_id;
  if (row.revoked_at !== null) record.revokedAt = new Date(row.revoked_at);
  return record;
}
function mapAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    capabilityId: row.capability_id,
    displayName: row.display_name,
    specialistRole: row.specialist_role,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class CapabilityEstateRepository {
  constructor(private readonly database: DatabaseQueryable) {}

  async createCapability(record: CapabilityRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO capability_catalogue
       (id, kind, source, source_ref, display_name, maturity, governance_state,
        execution_verification, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [record.id, record.kind, record.source, record.sourceRef, record.displayName,
       record.maturity, record.governanceState, record.executionVerification,
       record.createdBy, record.createdAt, record.updatedAt],
    );
  }
  async reconcileDiscoveredCapability(record: CapabilityRecord): Promise<CapabilityRecord> {
    const result = await this.database.query<CapabilityRow>(
      `INSERT INTO capability_catalogue
       (id, kind, source, source_ref, display_name, maturity, governance_state,
        execution_verification, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE
       SET source_ref=EXCLUDED.source_ref,
           display_name=EXCLUDED.display_name,
           maturity=EXCLUDED.maturity,
           updated_at=EXCLUDED.updated_at
       WHERE capability_catalogue.source=EXCLUDED.source
         AND capability_catalogue.kind=EXCLUDED.kind
       RETURNING ${CAPABILITY_COLUMNS}`,
      [record.id, record.kind, record.source, record.sourceRef, record.displayName,
       record.maturity, record.governanceState, record.executionVerification,
       record.createdBy, record.createdAt, record.updatedAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error('capability discovery collision on source or kind');
    return mapCapability(row);
  }
  async getCapability(id: string): Promise<CapabilityRecord | null> {
    const result = await this.database.query<CapabilityRow>(
      `SELECT ${CAPABILITY_COLUMNS} FROM capability_catalogue WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapCapability(row) : null;
  }

  async listCapabilities(kind?: CapabilityKind): Promise<CapabilityRecord[]> {
    const result = kind === undefined
      ? await this.database.query<CapabilityRow>(
          `SELECT ${CAPABILITY_COLUMNS} FROM capability_catalogue ORDER BY id ASC`,
        )
      : await this.database.query<CapabilityRow>(
          `SELECT ${CAPABILITY_COLUMNS} FROM capability_catalogue
           WHERE kind=$1 ORDER BY id ASC`,
          [kind],
        );
    return result.rows.map(mapCapability);
  }

  async createRelease(record: CapabilityReleasePolicy): Promise<void> {
    await this.database.query(
      `INSERT INTO capability_release_policies
       (id, capability_id, scope, organisation_id, project_id, project_role,
        team_id, cohort_id, user_id, status, created_by, created_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [record.id, record.capabilityId, record.scope, record.organisationId ?? null,
       record.projectId ?? null, record.projectRole ?? null, record.teamId ?? null,
       record.cohortId ?? null, record.userId ?? null, record.status,
       record.createdBy, record.createdAt, record.revokedAt ?? null],
    );
  }
  async updateCapabilityGovernanceState(
    id: string,
    governanceState: CapabilityRecord['governanceState'],
    when: Date,
  ): Promise<CapabilityRecord> {
    const result = await this.database.query<CapabilityRow>(
      `UPDATE capability_catalogue
       SET governance_state=$2, updated_at=$3
       WHERE id=$1
       RETURNING ${CAPABILITY_COLUMNS}`,
      [id, governanceState, when],
    );
    const row = result.rows[0];
    if (!row) throw new Error('capability not found');
    return mapCapability(row);
  }
  async listReleases(capabilityId: string): Promise<CapabilityReleasePolicy[]> {
    const result = await this.database.query<ReleaseRow>(
      `SELECT ${RELEASE_COLUMNS} FROM capability_release_policies
       WHERE capability_id=$1 ORDER BY created_at ASC, id ASC`,
      [capabilityId],
    );
    return result.rows.map(mapRelease);
  }
  async listAllReleases(): Promise<CapabilityReleasePolicy[]> {
    const result = await this.database.query<ReleaseRow>(
      `SELECT ${RELEASE_COLUMNS} FROM capability_release_policies
       ORDER BY capability_id ASC, created_at ASC, id ASC`,
    );
    return result.rows.map(mapRelease);
  }
  async getRelease(id: string): Promise<CapabilityReleasePolicy | null> {
    const result = await this.database.query<ReleaseRow>(
      `SELECT ${RELEASE_COLUMNS} FROM capability_release_policies WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapRelease(row) : null;
  }
  async revokeRelease(id: string, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE capability_release_policies
       SET status='revoked', revoked_at=$2
       WHERE id=$1 AND status='active' AND revoked_at IS NULL`,
      [id, when],
    );
    if (result.rowCount !== 1) throw new Error('active capability release not found');
  }

  async createEligibilityPolicy(record: CapabilityEligibilityPolicy): Promise<void> {
    await this.database.query(
      `INSERT INTO capability_eligibility_policies
       (id, capability_id, scope, organisation_id, project_id, project_role,
        team_id, cohort_id, user_id, decision, status, created_by, created_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [record.id, record.capabilityId, record.scope, record.organisationId,
       record.projectId ?? null, record.projectRole ?? null, record.teamId ?? null,
       record.cohortId ?? null, record.userId ?? null, record.decision, record.status,
       record.createdBy, record.createdAt, record.revokedAt ?? null],
    );
  }

  async listEligibilityPolicies(capabilityId: string): Promise<CapabilityEligibilityPolicy[]> {
    const result = await this.database.query<EligibilityRow>(
      `SELECT ${ELIGIBILITY_COLUMNS} FROM capability_eligibility_policies
       WHERE capability_id=$1 ORDER BY created_at ASC, id ASC`,
      [capabilityId],
    );
    return result.rows.map(mapEligibility);
  }
  async listAllEligibilityPolicies(): Promise<CapabilityEligibilityPolicy[]> {
    const result = await this.database.query<EligibilityRow>(
      `SELECT ${ELIGIBILITY_COLUMNS} FROM capability_eligibility_policies
       ORDER BY capability_id ASC, created_at ASC, id ASC`,
    );
    return result.rows.map(mapEligibility);
  }
  async revokeEligibilityPolicy(id: string, when: Date): Promise<void> {
    const result = await this.database.query(
      `UPDATE capability_eligibility_policies
       SET status='revoked', revoked_at=$2
       WHERE id=$1 AND status='active' AND revoked_at IS NULL`,
      [id, when],
    );
    if (result.rowCount !== 1) throw new Error('active capability eligibility policy not found');
  }
  async createAgent(record: AgentRecord): Promise<void> {
    const capability = await this.database.query<{ kind: CapabilityKind }>(
      `SELECT kind FROM capability_catalogue WHERE id=$1 FOR UPDATE`,
      [record.capabilityId],
    );
    if (capability.rows[0]?.kind !== 'agent') {
      throw new Error('agent metadata requires an agent capability');
    }
    await this.database.query(
      `INSERT INTO capability_agents
       (id, capability_id, display_name, specialist_role, description, status,
        created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [record.id, record.capabilityId, record.displayName, record.specialistRole,
       record.description, record.status, record.createdBy, record.createdAt, record.updatedAt],
    );
  }
  async getAgent(id: string): Promise<AgentRecord | null> {
    const result = await this.database.query<AgentRow>(
      `SELECT ${AGENT_COLUMNS} FROM capability_agents WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapAgent(row) : null;
  }
  async grantPopulationMembership(input: {
    organisationId: string; kind: 'team' | 'cohort'; populationId: string;
    userId: string; createdBy: string; now: Date;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO capability_population_memberships
       (organisation_id, population_kind, population_id, user_id, status,
        created_by, created_at, updated_at, revoked_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$6,NULL)
       ON CONFLICT (organisation_id, population_kind, population_id, user_id) DO UPDATE
       SET status='active', created_by=EXCLUDED.created_by,
           updated_at=EXCLUDED.updated_at, revoked_at=NULL`,
      [input.organisationId, input.kind, input.populationId,
       input.userId, input.createdBy, input.now],
    );
  }

  async revokePopulationMembership(input: {
    organisationId: string; kind: 'team' | 'cohort'; populationId: string;
    userId: string; now: Date;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE capability_population_memberships
       SET status='revoked', updated_at=$5, revoked_at=$5
       WHERE organisation_id=$1 AND population_kind=$2 AND population_id=$3
         AND user_id=$4 AND status='active'`,
      [input.organisationId, input.kind, input.populationId, input.userId, input.now],
    );
    if (result.rowCount !== 1) throw new Error('active capability population membership not found');
  }

  async listActivePopulationIds(
    organisationId: string,
    userId: string,
  ): Promise<{ teamIds: string[]; cohortIds: string[] }> {
    const result = await this.database.query<{ population_kind: 'team' | 'cohort'; population_id: string }>(
      `SELECT population_kind, population_id
       FROM capability_population_memberships
       WHERE organisation_id=$1 AND user_id=$2 AND status='active'
       ORDER BY population_kind ASC, population_id ASC`,
      [organisationId, userId],
    );
    return {
      teamIds: result.rows.filter((row) => row.population_kind === 'team').map((row) => row.population_id),
      cohortIds: result.rows.filter((row) => row.population_kind === 'cohort').map((row) => row.population_id),
    };
  }}
