import { describe, expect, it } from 'vitest'
import { documentaryEvaluator } from '../src/evaluators/documentary.ts'
import { electronicEvaluator } from '../src/evaluators/electronic.ts'
import { witnessTestimonyEvaluator } from '../src/evaluators/witness-testimony.ts'
import { expertOpinionEvaluator } from '../src/evaluators/expert-opinion.ts'
import { partyStatementEvaluator, physicalEvaluator, audioVisualEvaluator, inspectionRecordEvaluator } from '../src/evaluators/other-types.ts'
import type { LegalEvidenceInput } from '../src/types.ts'

describe('documentaryEvaluator', () => {
  it('scores high authenticity when original and signature are verified', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'doc-1',
      evidenceType: 'documentary',
      hasOriginal: true,
      signatureVerified: true,
      formationTimeClear: true,
    }
    const result = documentaryEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.7)
    expect(result.level).toBe('high')
  })

  it('scores low authenticity when original is missing without reason', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'doc-2',
      evidenceType: 'documentary',
      hasOriginal: false,
    }
    const result = documentaryEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeLessThan(0.5)
  })

  it('reports critical finding when original is missing', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'doc-3',
      evidenceType: 'documentary',
      hasOriginal: false,
    }
    const findings = documentaryEvaluator.checkFindings(input)
    expect(findings.some(f => f.ruleId === 'LEGAL-EVI-001' && !f.passed && f.severity === 'critical')).toBe(true)
  })
})

describe('electronicEvaluator', () => {
  it('scores high authenticity when hash is verified and storage is intact', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'elec-1',
      evidenceType: 'electronic',
      contentHash: 'sha256:abc123',
      hashVerified: true,
      timestamp: '2024-01-15T10:30:00Z',
      storageIntegrityVerified: true,
    }
    const result = electronicEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.7)
  })

  it('reports critical finding when storage integrity is not verified', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'elec-2',
      evidenceType: 'electronic',
      storageIntegrityVerified: false,
    }
    const findings = electronicEvaluator.checkFindings(input)
    expect(findings.some(f => f.ruleId === 'LEGAL-EVI-004' && !f.passed && f.severity === 'critical')).toBe(true)
  })
})

describe('witnessTestimonyEvaluator', () => {
  it('scores high authenticity when no conflict and corroborated', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'wit-1',
      evidenceType: 'witness_testimony',
      witnessHasConflict: false,
      corroborated: true,
    }
    const result = witnessTestimonyEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.6)
  })

  it('reports critical finding when conflict is not disclosed', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'wit-2',
      evidenceType: 'witness_testimony',
      witnessHasConflict: true,
      conflictDisclosed: false,
    }
    const findings = witnessTestimonyEvaluator.checkFindings(input)
    expect(findings.some(f => f.ruleId === 'LEGAL-EVI-007' && !f.passed && f.severity === 'critical')).toBe(true)
  })
})

describe('expertOpinionEvaluator', () => {
  it('scores high legality when qualified and procedure is legal', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'exp-1',
      evidenceType: 'expert_opinion',
      expertQualified: true,
      expertProcedureLegal: true,
    }
    const result = expertOpinionEvaluator.evaluateLegality(input)
    expect(result.score).toBeGreaterThan(0.7)
  })

  it('reports critical finding when not qualified', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'exp-2',
      evidenceType: 'expert_opinion',
      expertQualified: false,
    }
    const findings = expertOpinionEvaluator.checkFindings(input)
    expect(findings.some(f => f.ruleId === 'LEGAL-EVI-009' && !f.passed && f.severity === 'critical')).toBe(true)
  })
})

describe('partyStatementEvaluator', () => {
  it('scores higher when corroborated', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'party-1',
      evidenceType: 'party_statement',
      corroborated: true,
    }
    const result = partyStatementEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.5)
  })
})

describe('physicalEvaluator', () => {
  it('scores higher when original is provided', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'phys-1',
      evidenceType: 'physical',
      hasOriginal: true,
    }
    const result = physicalEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.5)
  })
})

describe('audioVisualEvaluator', () => {
  it('scores higher when hash is provided and verified', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'av-1',
      evidenceType: 'audio_visual',
      contentHash: 'sha256:def456',
      hashVerified: true,
    }
    const result = audioVisualEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.5)
  })
})

describe('inspectionRecordEvaluator', () => {
  it('scores higher when witness is present and record is complete', () => {
    const input: LegalEvidenceInput = {
      evidenceId: 'insp-1',
      evidenceType: 'inspection_record',
      inspectionHasWitness: true,
      inspectionRecordComplete: true,
    }
    const result = inspectionRecordEvaluator.evaluateAuthenticity(input)
    expect(result.score).toBeGreaterThan(0.6)
  })
})
