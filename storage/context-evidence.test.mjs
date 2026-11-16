import {expect,it} from 'vitest'
import {contextEvidenceErrors, appendContextEvidence, contextEvidenceProjection} from './context-evidence.mjs'
import {studentReviewProjection} from './review-projection.mjs'
import {assertContextEvidenceReadback} from './review-readback.mjs'
import {platformAssignmentErrors} from '../day/homework-kind.mjs'

const packet={purpose:'context-evidence',date:'2026-11-16',taskId:'mesh-123',planRevision:4,uploadIds:['screenshot-1234567890123456'],evidence:{type:'platform-result',title:'Гидросфера',points:10,maxPoints:10,duration:3,observedDate:'2026-11-16',uploadId:'screenshot-1234567890123456',location:'Карточка результата тематического теста',summary:'На присланном снимке виден результат тематического теста МЭШ.'}}
it('records context without assigning platform work or replacing an existing assessment',()=>{
 expect(contextEvidenceErrors(packet)).toEqual([])
 const prior={taskId:packet.taskId,status:'verified',checkedAt:17,planRevision:2,uploadIds:['old-photo'],studentFeedback:{title:'Ранее проверенная работа'},learningObservationId:'unchanged'}
 const full=appendContextEvidence(prior,packet,18)
 expect(full).toMatchObject(prior)
 expect(full.contextEvidence).toHaveLength(1)
 expect(full.contextEvidence[0]).toMatchObject({...packet.evidence,purpose:'context-evidence',checkedAt:18})
 expect(appendContextEvidence(full,packet,19).contextEvidence).toEqual(full.contextEvidence)
 expect(platformAssignmentErrors({meshText:'п.38',outputKind:'reading',platformResult:{state:'completed',correct:10,total:10}})).toHaveLength(1)
 const projected=studentReviewProjection({...full,answerKey:'private'})
 expect(projected.contextEvidence).toEqual(contextEvidenceProjection(full.contextEvidence))
 expect(projected).not.toHaveProperty('answerKey')
 expect(assertContextEvidenceReadback({entry:packet,previous:prior,privateDoc:full,publicDoc:projected,uploads:[{id:packet.uploadIds[0],status:'reviewed'}]}).verified).toBe(true)
 expect(()=>assertContextEvidenceReadback({entry:packet,previous:prior,privateDoc:{...full,status:'partial'},publicDoc:projected,uploads:[{id:packet.uploadIds[0],status:'reviewed'}]})).toThrow()
})
it('has no assignment verdict, coverage, learning observation or hidden content in a standalone receipt',()=>{
 const full=appendContextEvidence(undefined,packet,18),projected=studentReviewProjection(full)
 for(const key of ['status','checkedAt','workCoverage','assessmentBasis','learningObservationId'])expect(full).not.toHaveProperty(key)
 expect(projected.contextEvidence).toHaveLength(1)
 expect(contextEvidenceProjection([{...full.contextEvidence[0],answerKey:'secret'}])[0]).not.toHaveProperty('answerKey')
})
it('rejects missing photo attribution, invalid scores, impossible dates and grading payloads',()=>{
 for(const evidence of [{...packet.evidence,points:11},{...packet.evidence,maxPoints:0},{...packet.evidence,observedDate:'2026-02-31'},{...packet.evidence,uploadId:'other-photo'},{...packet.evidence,answerKey:'private'}])expect(contextEvidenceErrors({...packet,evidence}).length).toBeGreaterThan(0)
 for(const extra of [{status:'verified'},{workCoverage:{state:'complete'}},{assessmentBasis:{outcome:'met'}},{learningObservationId:'new'},{reviews:[]}])expect(contextEvidenceErrors({...packet,...extra}).length).toBeGreaterThan(0)
})
