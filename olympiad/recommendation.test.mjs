import { describe, expect, it } from 'vitest'
import { recommendLesson } from './recommendation.mjs'
const lessons = [{id:'a',topicId:'x',verified:true,available:true},{id:'b',topicId:'y',verified:true,available:true},{id:'c',topicId:'x',verified:false,available:true}]
describe('recommendation respects evidence and family choice',()=>{
 it('keeps a specific parent choice first without closing other lessons',()=>expect(recommendLesson({lessons,parentChoice:{kind:'lesson',id:'b',active:true}})).toEqual({state:'ready',lessonId:'b',reason:'parent-choice'}))
 it('allows a parent to recommend a completed lesson again',()=>expect(recommendLesson({lessons,completedLessonIds:['a'],parentChoice:{kind:'lesson',id:'a',active:true}})).toEqual({state:'ready',lessonId:'a',reason:'parent-choice'}))
 it('honestly waits if a selected topic lacks a verified lesson',()=>expect(recommendLesson({lessons,parentChoice:{kind:'topic',id:'z',active:true}})).toEqual({state:'waiting',reason:'parent-choice-unavailable'}))
 it('uses an explicit difficulty topic without claiming a diagnosis',()=>expect(recommendLesson({lessons,difficultyTopicId:'y'})).toEqual({state:'ready',lessonId:'b',reason:'follow-up'}))
 it('ignores fulfilled parent choices and unavailable, unverified and completed lessons',()=>expect(recommendLesson({lessons,completedLessonIds:['a'],parentChoice:{kind:'lesson',id:'a',active:true,fulfilled:true}})).toEqual({state:'ready',lessonId:'b',reason:'next-available'}))
 it('does not invent a result when no verified lessons exist',()=>expect(recommendLesson({lessons:[]})).toEqual({state:'waiting',reason:'no-verified-lesson'}))
})
