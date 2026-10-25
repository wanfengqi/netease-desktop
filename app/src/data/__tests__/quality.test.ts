import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
const {neteaseUrl,miguUrl}=vi.hoisted(()=>({neteaseUrl:vi.fn(),miguUrl:vi.fn()}));
vi.mock('../repository/index',()=>({netease:{songUrl:neteaseUrl},migu:{songUrl:miguUrl}}));
import {resolveSongUrl} from '../source';
import {useConfigStore} from '../../stores/config';
import type {Song} from '../normalize';
beforeEach(()=>{setActivePinia(createPinia());vi.clearAllMocks();Object.assign(globalThis,{window:{api:{downloads:{list:async()=>({records:[]})},local:{mediaUrl:async()=>null}}}});neteaseUrl.mockResolvedValue({url:'https://example.invalid/audio',level:'server',auditionMs:0});miguUrl.mockResolvedValue({url:'https://example.invalid/audio',level:'server',auditionMs:0});});
describe('quality parameter routing',()=>{it('routes netease configured level to repository',async()=>{const config=useConfigStore();config.config={extra:{settings:{quality:{netease:'lossless'}}}} as never;await resolveSongUrl({id:42,source:'netease'} as Song);expect(neteaseUrl).toHaveBeenCalledWith(42,'lossless');});it('routes migu toneFlag and preserves actual server quality',async()=>{const config=useConfigStore();config.config={extra:{settings:{quality:{migu:'SQ'}}}} as never;miguUrl.mockResolvedValue({url:'x',level:'HQ',auditionMs:0});const result=await resolveSongUrl({id:'1',source:'migu'} as Song);expect(miguUrl).toHaveBeenCalledWith(expect.objectContaining({id:'1'}),'SQ');expect(result.level).toBe('HQ');});});
