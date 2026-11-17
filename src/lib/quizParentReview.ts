/** Read only one authorized parent document; no collection discovery.
 * @see ../../docs/modules/reviews/parent-review.md */
/** @see ../../docs/decisions/parent-review-pilot-2026-11-17.md */
import {doc,onSnapshot} from 'firebase/firestore'
import {db} from './firebase'
export function watchQuizParentReview(token:string,questionId:string,change:(record:unknown)=>void,error:()=>void){
 return onSnapshot(doc(db,'quizParentReviews',token,'items',questionId),snapshot=>change(snapshot.exists()?snapshot.data():null),error)
}
