import { expect, test } from 'bun:test'
import { digestCanonical } from 'halfcode-compiler-resource-core'
import { KindContractRegistry, createKindSubjectOwner } from './versioned-contracts'

test('Kind subjects share a short name without losing explicit identity or owner conflicts', () => {
  const owner = (subjectFqn: string) => createKindSubjectOwner({
    kind: 'Page', subjectFqn, ownerPackageId: subjectFqn,
    ownerPackageFingerprint: digestCanonical({ subjectFqn }), sourceShapes: ['single-file'],
  })
  const dg = owner('Test.DG.Page')
  const lite = owner('Test.Lite.Page')
  const registry = new KindContractRegistry().registerOwner(dg)
  expect(registry.subject('Page')).toEqual(dg)
  registry.registerOwner(lite)
  expect(registry.subject('Test.DG.Page')).toEqual(dg)
  expect(registry.subject('Page', 'Test.Lite.Page')).toEqual(lite)
  expect(() => registry.subject('Page')).toThrow('KIND_SUBJECT_AMBIGUOUS')
  expect(() => registry.subject('Component', 'Test.Lite.Page')).toThrow('KIND_SUBJECT_MISMATCH')
  expect(() => registry.registerOwner({ ...dg, ownerPackageId: 'another-owner' })).toThrow('KIND_SUBJECT_OWNER_CONFLICT')
})
