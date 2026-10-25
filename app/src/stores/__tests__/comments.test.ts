import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Comment, Song } from '../../data/normalize';
import { appendUnique, useCommentsStore } from '../comments';

function comment(id:number):Comment{return {commentId:id,content:'评论 '+id,likedCount:id,time:id,timeStr:'今天',user:{nickname:'用户',avatarUrl:''},beReplied:[]};}
const song={source:'netease',id:9,name:'真实歌曲',artistText:'歌手',artists:[],album:{name:'',picUrl:''},duration:1} satisfies Song;
beforeEach(()=>setActivePinia(createPinia()));

describe('comments pagination and errors',()=>{
 it('deduplicates hot and paginated latest comments without using total as page size',async()=>{
  const store=useCommentsStore();const pages:number[]=[];
  store.configure(async(_id,page)=>{pages.push(page);return {items:[comment(3),comment(3),comment(4)],hot:[comment(1),comment(1),comment(2)],hasMore:page<2,total:999};});
  await store.load(song,'hot');expect(store.items.map(x=>x.commentId)).toEqual([1,2]);expect(store.total).toBe(999);expect(store.count).toBe(2);
  await store.loadMore();expect(store.items.map(x=>x.commentId)).toEqual([1,2,3,4]);expect(store.page).toBe(2);
  await store.load(song,'latest');await store.loadMore();expect(pages).toEqual([1,2,1,2]);expect(store.count).toBe(2);expect(store.hasMore).toBe(false);
  expect(appendUnique([comment(1)],[comment(1),comment(2)])).toHaveLength(2);
 });
 it('keeps loaded items on a later-page error and supports retry',async()=>{
  const store=useCommentsStore();let fail=false;
  store.configure(async()=>{if(fail)throw new Error('network down');return {items:[comment(1)],hot:[comment(1)],hasMore:true,total:20};});
  await store.load(song);fail=true;await store.loadMore();expect(store.error).toBe('network down');expect(store.count).toBe(1);expect(store.page).toBe(1);
  fail=false;await store.loadMore();expect(store.error).toBe('');expect(store.page).toBe(2);
 });
 it('resets song state so a response from the previous song cannot leak',async()=>{
  const store=useCommentsStore();store.configure(async()=>({items:[comment(1)],hot:[comment(1)],hasMore:false}));
  await store.load(song);store.reset();expect(store.songKey).toBe('');expect(store.count).toBe(0);expect(store.error).toBe('');
 });
});
