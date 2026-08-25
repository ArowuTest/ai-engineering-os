import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@engineering-os/domain';
import { MembershipRepository, PlatformMembershipRepository, UserRepository } from '@engineering-os/database';
import { createRuntimeApp } from '../src/server.js';
import { closeDatabase, databaseUrl, pool, resetDatabase } from '../../../packages/database/test/database-test-harness.js';

const capability = {
  id: 'model.project-policy', kind: 'model_route', source: 'model_gateway', sourceRef: 'openai-api',
  displayName: 'Project Policy Model', maturity: 'supported', governanceState: 'approved', executionVerification: 'verified',
};
function runtime() { return createRuntimeApp({ DATABASE_URL: databaseUrl, OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test', ALLOW_DEV_IDENTITY_HEADERS: 'false' }); }
async function seed(login: string, password: string) {
  const id=randomUUID(), now=new Date();
  await new UserRepository(pool).create({ id, userId: login, passwordHash: await hashPassword(password), status:'active', createdAt:now, updatedAt:now });
  return id;
}
async function token(app: ReturnType<typeof runtime>['app'], login: string, password: string) {
  const r=await app.inject({method:'POST',url:'/auth/login',payload:{userId:login,password}}); expect(r.statusCode).toBe(200); return (r.json() as {token:string}).token;
}
async function project(memberId: string, role: 'product_owner'|'engineer') {
  const id=randomUUID(), now=new Date();
  await pool.query(`INSERT INTO projects (id,organisation_id,name,created_by,created_at,stage,preferred_product_partner,updated_at)
    VALUES ($1,'org-001','Policy Project','test',$2,'discovery','auto',$2)`,[id,now]);
  await new MembershipRepository(pool).grantProject({organisationId:'org-001',projectId:id,userId:memberId,role,createdBy:'test',now});
  return id;
}

describe('project capability policy authority',()=>{
  beforeEach(async()=>resetDatabase(),30_000); afterAll(async()=>closeDatabase());
  it('lets project product_owner manage only its project policy while engineer cannot',async()=>{
    const platform=await seed('policy.platform','Policy-platform-2026!');
    const owner=await seed('policy.po','Policy-po-2026!');
    const engineer=await seed('policy.engineer','Policy-engineer-2026!'); const now=new Date();
    await new PlatformMembershipRepository(pool).grantAdmin({userId:platform,createdBy:'bootstrap',now});
    for(const id of [owner,engineer]) await new MembershipRepository(pool).grantOrganisation({organisationId:'org-001',userId:id,role:'member',createdBy:'test',now});
    const projectId=await project(owner,'product_owner');
    await new MembershipRepository(pool).grantProject({organisationId:'org-001',projectId,userId:engineer,role:'engineer',createdBy:'test',now});
    const instance=runtime();
    const pToken=await token(instance.app,'policy.platform','Policy-platform-2026!');
    const poToken=await token(instance.app,'policy.po','Policy-po-2026!');
    const eToken=await token(instance.app,'policy.engineer','Policy-engineer-2026!');
    expect((await instance.app.inject({method:'POST',url:'/admin/capabilities',headers:{authorization:`Bearer ${pToken}`},payload:capability})).statusCode).toBe(201);
    const org=(t:string)=>({authorization:`Bearer ${t}`,'x-organisation-id':'org-001'});
    const release=await instance.app.inject({method:'POST',url:`/admin/capabilities/${capability.id}/releases`,headers:org(poToken),payload:{scope:'project',projectId}});
    expect(release.statusCode).toBe(201);
    const eligibility=await instance.app.inject({method:'POST',url:`/admin/capabilities/${capability.id}/eligibility`,headers:org(poToken),payload:{scope:'project',projectId,decision:'deny'}});
    expect(eligibility.statusCode).toBe(201);
    expect((await instance.app.inject({method:'POST',url:`/admin/capabilities/${capability.id}/releases`,headers:org(eToken),payload:{scope:'project',projectId}})).statusCode).toBe(403);
    expect((await instance.app.inject({method:'POST',url:`/admin/capabilities/${capability.id}/releases`,headers:org(poToken),payload:{scope:'organisation'}})).statusCode).toBe(403);
    expect((await instance.app.inject({method:'POST',url:`/admin/capabilities/${capability.id}/releases`,headers:org(poToken),payload:{scope:'project_role',projectRole:'engineer'}})).statusCode).toBe(403);
    expect((await instance.app.inject({method:'POST',url:`/admin/capabilities/${capability.id}/releases`,headers:org(poToken),payload:{scope:'project_role',projectId,projectRole:'engineer'}})).statusCode).toBe(201);
    await instance.close();
  });
});
