export type { IPersistenceAdapter, ProjectSummary } from './types'
export { LocalAdapter, localAdapter } from './local'
export { CmsAdapter, cmsAdapter } from './cms'
export { validateProject, ValidationError } from './validate'
// usePersistence moved to src/editor/hooks/usePersistence.ts (Constraint #179 — no React in core)
