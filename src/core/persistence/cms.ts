import type { Project } from '../page-tree/types'
import type { IPersistenceAdapter, ProjectSummary } from './types'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class CmsAdapter implements IPersistenceAdapter {
  private readonly fetchImpl: FetchLike
  private readonly basePath: string

  constructor(
    fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
    basePath = '/api/cms',
  ) {
    this.fetchImpl = fetchImpl
    this.basePath = basePath
  }

  async saveProject(project: Project): Promise<void> {
    const res = await this.fetchImpl(`${this.basePath}/project`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    })
    if (!res.ok) throw new Error(`CMS save failed with ${res.status}`)
  }

  async loadProject(_id: string): Promise<Project | undefined> {
    const res = await this.fetchImpl(`${this.basePath}/project`, {
      method: 'GET',
      credentials: 'include',
    })
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error(`CMS load failed with ${res.status}`)
    const body = await res.json() as { project?: Project }
    return body.project
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const project = await this.loadProject('default')
    if (!project) return []
    return [{
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      pageCount: project.pages.length,
    }]
  }

  async deleteProject(_id: string): Promise<void> {
    throw new Error('CMS mode uses a single site draft and does not support project deletion.')
  }
}

export const cmsAdapter = new CmsAdapter()
