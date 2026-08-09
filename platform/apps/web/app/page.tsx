import Link from 'next/link';
import { listProjects, type ProductPartner } from '../lib/api';

export const dynamic = 'force-dynamic';

const partnerLabels: Record<ProductPartner, string> = {
  auto: 'Auto select',
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
};

function stageLabel(stage: string): string {
  return stage.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function DashboardPage() {
  const projects = await listProjects();

  return (
    <main className="page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Product portfolio</span>
          <h1>Build products from ideas, not scattered chats.</h1>
          <p className="lead">
            Product Studio keeps one governed product definition while AI partners and, later,
            engineering agents can change underneath it.
          </p>
        </div>
        <Link className="button" href="/projects/new">Create Product</Link>
      </div>

      {projects.length === 0 ? (
        <section className="empty-state">
          <h2>No products yet</h2>
          <p>Start with an idea. Product Studio will turn it into governed product knowledge.</p>
          <Link className="button" href="/projects/new">Create your first product</Link>
        </section>
      ) : (
        <section className="project-grid" aria-label="Projects">
          {projects.map((project) => (
            <Link className="project-card" href={`/projects/${project.id}`} key={project.id}>
              <div>
                <div className="card-topline">
                  <span className="stage-pill">{stageLabel(project.stage)}</span>
                  <span className="status-pill">{partnerLabels[project.preferredProductPartner]}</span>
                </div>
                <h2>{project.name}</h2>
                <p>{project.description || 'Product discovery in progress.'}</p>
              </div>
              <div className="card-meta">
                <div className="meta-row">
                  <span>Definition coverage</span>
                  <strong>{project.completeness.percentage}%</strong>
                </div>
                <div className="progress-track" aria-label={`${project.completeness.percentage}% complete`}>
                  <div className="progress-fill" style={{ width: `${project.completeness.percentage}%` }} />
                </div>
                <div className="meta-row">
                  <span>Open areas</span>
                  <strong>{project.completeness.missingCategories.length}</strong>
                </div>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
