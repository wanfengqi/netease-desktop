<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import type { Song } from '../data/normalize';
import { useCommentsStore, type CommentTab } from '../stores/comments';
import Icon from './Icon.vue';

const props = defineProps<{ song: Song }>();
const emit = defineEmits<{ close: [] }>();
const comments = useCommentsStore();

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}
async function change(tab: CommentTab): Promise<void> {
  await comments.load(props.song, tab);
}
function formatTime(time: number, label: string): string {
  if (label) return label;
  return time > 0 ? new Date(time).toLocaleString() : '时间未知';
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  void comments.load(props.song);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  comments.reset();
});
</script>

<template>
  <Teleport to="body">
    <div class="comments-mask" data-testid="comments-mask" @mousedown.self="emit('close')">
      <section class="comments-panel" role="dialog" aria-modal="true" aria-label="歌曲评论" @mousedown.stop>
        <header class="comments-head">
          <div><h2>歌曲评论</h2><p>{{ song.name }} · {{ song.artistText }}</p></div>
          <button type="button" class="comments-close" title="关闭评论" @click="emit('close')"><Icon name="close" :size="18" /></button>
        </header>
        <nav class="comments-tabs">
          <button type="button" :class="{ active: comments.tab === 'hot' }" @click="change('hot')">热门评论</button>
          <button type="button" :class="{ active: comments.tab === 'latest' }" @click="change('latest')">最新评论</button>
          <span v-if="comments.total !== undefined">累计 {{ comments.total }} 条</span>
        </nav>
        <div class="comments-body">
          <div v-if="comments.loading && comments.items.length === 0" class="comments-state">正在加载评论…</div>
          <div v-else-if="comments.error && comments.items.length === 0" class="comments-state error"><p>{{ comments.error }}</p><button @click="comments.loadMore()">重试</button></div>
          <div v-else-if="comments.items.length === 0" class="comments-state">还没有评论</div>
          <template v-else>
            <article v-for="comment in comments.items" :key="comment.commentId" class="comment" :data-comment-id="comment.commentId">
              <img v-if="comment.user?.avatarUrl" :src="comment.user.avatarUrl" alt="" class="comment-avatar">
              <span v-else class="comment-avatar fallback"><Icon name="artist" :size="20" /></span>
              <div class="comment-main">
                <div class="comment-user"><strong>{{ comment.user?.nickname || '匿名用户' }}</strong><span>{{ formatTime(comment.time, comment.timeStr) }}</span></div>
                <p>{{ comment.content }}</p>
                <blockquote v-for="reply in comment.beReplied" :key="reply.nickname + reply.content">回复 {{ reply.nickname }}：{{ reply.content }}</blockquote>
                <div class="comment-likes">赞 {{ comment.likedCount }}</div>
              </div>
            </article>
            <p v-if="comments.error" class="comments-error">{{ comments.error }}</p>
          </template>
        </div>
        <footer class="comments-foot">
          <span>已显示 {{ comments.items.length }} 条</span>
          <button v-if="comments.hasMore" :disabled="comments.loading" data-testid="comments-more" @click="comments.loadMore()">{{ comments.loading ? '加载中…' : '加载更多' }}</button>
          <span v-else-if="comments.items.length > 0">没有更多了</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.comments-mask{position:fixed;inset:var(--titlebar-h) 0 0;z-index:80;display:flex;justify-content:flex-end;background:rgba(0,0,0,.48);-webkit-app-region:no-drag}.comments-panel{width:min(560px,80vw);display:flex;flex-direction:column;background:var(--app-bg);border-left:1px solid var(--app-border);box-shadow:-18px 0 45px rgba(0,0,0,.28)}.comments-head{display:flex;justify-content:space-between;align-items:center;padding:20px 22px;border-bottom:1px solid var(--app-border)}h2{margin:0 0 5px;color:var(--text-strong);font-size:18px}.comments-head p{margin:0;font-size:12px;color:var(--text-muted)}button{border:1px solid var(--app-border);border-radius:6px;background:var(--panel-bg);color:var(--text);padding:6px 12px;cursor:pointer}.comments-close{display:grid;place-items:center;border:0;background:transparent;padding:7px}.comments-tabs{display:flex;gap:8px;padding:12px 22px;border-bottom:1px solid var(--app-border)}.comments-tabs button.active{border-color:var(--accent);color:var(--accent)}.comments-tabs span{margin-left:auto;color:var(--text-muted);font-size:11px}.comments-body{flex:1;min-height:0;overflow-y:auto;padding:0 22px}.comments-state{display:grid;place-items:center;min-height:220px;color:var(--text-muted);font-size:13px}.comment{display:flex;gap:12px;padding:18px 0;border-bottom:1px solid var(--app-border)}.comment-avatar{width:36px;height:36px;flex:0 0 36px;border-radius:50%;object-fit:cover}.fallback{display:grid;place-items:center;background:var(--panel-hover);color:var(--text-muted)}.comment-main{min-width:0;flex:1}.comment-user{display:flex;justify-content:space-between;gap:8px}.comment-user strong{font-size:12px;color:var(--accent)}.comment-user span{color:var(--text-muted);font-size:10px;white-space:nowrap}.comment-main p{margin:9px 0;color:var(--text);font-size:13px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.comment-main blockquote{margin:8px 0;padding:8px 10px;border-radius:6px;background:var(--panel-bg);color:var(--text-muted);font-size:12px;line-height:1.6}.comment-likes{color:var(--text-muted);font-size:11px;text-align:right}.comments-foot{display:flex;align-items:center;justify-content:space-between;padding:13px 22px;border-top:1px solid var(--app-border);color:var(--text-muted);font-size:11px}.comments-error{color:var(--accent);font-size:12px}
</style>
