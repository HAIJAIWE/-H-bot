<!-- 本文件由 scripts/gen-nodes-reference.mjs 生成，请勿手改；改节点请改 src/shared/nodes/groups/ 后重新生成 -->

# 节点参考

> 数据源：`src/shared/nodes/groups/*.ts` 的 NODE_CATALOG_V2，共 **76** 个节点（其中弃用 **5** 个）。
>
> 重新生成：`node scripts/gen-nodes-reference.mjs`；校验：`node scripts/gen-nodes-reference.mjs --check`。

## 分组一览

| 分组 | 节点数 |
| --- | --- |
| 触发器 | 7 |
| 消息 | 6 |
| 动作 | 11 |
| 判断 | 3 |
| 控制流 | 13 |
| 数据 | 11 |
| AI | 3 |
| 存储 | 10 |
| 计算 | 6 |
| 上下文 | 4 |
| 文本 | 2 |

## 触发器（7）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `message_received` | 收到消息 | trigger | — | — | next、event(event)、raw_message(string)、args(list)、ark_type(string)、matched(string)、groups(list) |  |
| `scheduled` | 定时触发 | trigger | — | — | next、time(datetime) |  |
| `request_received` | 请求事件 | trigger | — | — | next、event(event)、request_type(string)、user_id(string)、group_id(string)、comment(string)、flag(string) |  |
| `notice_received` | 通知事件 | trigger | — | — | next、event(event)、notice_type(string)、user_id(string)、group_id(string)、sub_type(string)、operator_id(string) |  |
| `button_clicked` | 按钮点击 | trigger | — | — | next、event(event)、button_id(string)、button_data(string)、user_id(string)、group_id(string) |  |
| `on_ready` | 连接就绪 | trigger | — | — | next、event(event)、ready_at(number) |  |
| `on_startup` | 机器人启动 | trigger | — | — | next、event(event)、started_at(number) |  |

## 消息（6）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `message_send` | 发消息 | handler:message_send | 发消息 | in、mode(string)、text(string)、var1(any)、var2(any)、var3(any)、var4(any)、markdown(string)、force_verify_image_resource(boolean)、keyboard(object)、segments(json)、messages(string)、user_id(string)、media_url(string)、media_type(string)、file_name(string)、reply_to(string)、is_wakeup(boolean)、stream_content_type(string)、stream_chunk_size(number)、stream_interval_ms(number)、input_second(number)、ark_template_id(number)、ark_kv(json)、embed_title(string)、embed_prompt(string)、embed_description(string)、embed_thumbnail(string)、embed_fields(json)、target_type(string)、target_id(string) | out、success(boolean)、message_id(string)、error(string) |  |
| `message_recall` | 撤回 | handler:message_recall | 撤回消息 | in、message_id(string) | out、success(boolean)、error(string) |  |
| `message_edit` | 编辑消息 | handler:message_edit | 编辑消息 | in、message_id(string)、new_text(string) | out、success(boolean)、error(string) |  |
| `message_op` | 构造消息段 | handler:message_op | 构造消息段 | in、segment_type(string)、user_id(string)、url(string)、file(string)、face_id(number)、title(string)、content(string)、image_url(string)、music_type(string)、audio_url(string)、singer(string)、message_id(string)、forward_id(string) | out、segment(any)、success(boolean)、error(string) |  |
| `message_compose` | 拼装消息 | handler:message_compose | 拼装消息卡片 | in、layout(string)、title(string)、subtitle(string)、body(any)、stats(any)、bars(any)、quote(string)、footer(string)、buttons(any)、buttons_json(json)、inline_commands(any)、items(any)、empty_text(string)、page(number)、page_size(number)、page_command(string)、paging_json(json)、title_level(number)、max_length(number) | out、markdown(string)、keyboard(object)、button_count(number)、success(boolean)、error(string)、warnings(list) |  |
| `battle_panel` | 战斗面板 | handler:battle_panel | 战斗面板 | in、monster_name(string)、monster_level(number/string)、monster_tag(string)、monster_hp(number)、monster_max_hp(number)、player_name(string)、player_hp(number)、player_max_hp(number)、player_mp(number)、player_max_mp(number)、round(number)、log(string)、footer(string)、actions(string)、command_prefix(string)、bar_width(number) | out、markdown(string)、keyboard(json)、button_count(number)、success(boolean)、error(string) |  |

## 动作（11）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `group_op` | 群管理 | handler:group_op | 群管理 | in、mode(string)、group_id(string)、user_id(string)、user_ids(string)、duration(number)、enable(boolean)、card(string)、title(string)、flag(string)、approve(boolean)、sub_type(string)、remark(string)、content(string)、file_path(string)、file_name(string)、message_id(string) | out、success(boolean)、error(string) |  |
| `join_approval` | 入群自动审批 | handler:join_approval | 入群自动审批 | in、mode(string)、strategy_id(string)、group_openids(string)、group_ids(string)、is_enable(string)、expire_at(string)、remark(string)、group_op(string)、op(string)、whitelist_users(string)、cursor(string)、limit(number) | out、success(boolean)、data(any)、error(string) |  |
| `channel_op` | 频道操作 | handler:channel_op | 频道操作 | in、mode(string)、guild_id(string)、channel_id(string)、message_id(string)、name(string)、type(string)、position(number)、parent_id(string)、speak_permission(number)、announces_type(number)、recommend_channels(json)、emoji_type(string)、emoji_id(string) | out、success(boolean)、data(any)、error(string) |  |
| `answer_interaction` | 按钮响应 | handler:answer_interaction | 按钮响应 | in、interaction_id(string)、code(number) | out、success(boolean)、error(string) |  |
| `menu_config` | 自定义菜单 | handler:menu_config | 自定义菜单 | in、mode(string)、menu(json) | out、success(boolean)、data(any)、error(string) |  |
| `panel_config` | 指令面板 | handler:panel_config | 指令面板 | in、mode(string)、scope(string)、panel_id(string)、target_type(string)、user_openids(string)、group_openids(string)、panel(json) | out、success(boolean)、data(any)、error(string) |  |
| `api_call` | API 调用 | handler:api_call | API 调用 | in、action(string)、params(json) | out、result(json)、success(boolean)、data(json)、error(string) |  |
| `http_request` | HTTP 请求 | handler:http_request | HTTP 请求 | in、url(string)、method(string)、headers(json)、body(any)、timeout(number)、params(json)、response_format(string)、max_response_size(number) | out、status(number)、data(any)、text(string)、error(string) |  |
| `file_operate` | 文件操作 | handler:file_operate | 文件操作 | in、mode(string)、file_path(string)、dest_path(string)、content(any)、write_mode(string)、encoding(string)、append(boolean) | out、result(any)、success(boolean)、path(string)、size(number)、exists(boolean)、is_file(boolean)、is_dir(boolean)、count(number)、error(string) | 已弃用（2026-10-03） |
| `system_log` | 系统日志 | handler:system_log | — | in、level(string)、message(string) | out、error(string) |  |
| `bot_info` | 机器人信息 | handler:bot_info | 机器人信息 | in、mode(string)、callback_data(string) | out、success(boolean)、data(any)、error(string) |  |

## 判断（3）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `branch_if` | 条件分支 | interpreter | — | in、value(any) | true、false |  |
| `branch_switch` | 多分支选择 | interpreter | — | in、value(any)、cases(string)、default(string) | out、matched(string)、matched_value(string)、index(number)、is_default(boolean) |  |
| `check_permission` | 权限检查 | handler:check_permission | — | in、role(string) | out、passed(boolean)、user_role(string)、error(string) |  |

## 控制流（13）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `delay` | 延迟 | handler:delay | — | in、seconds(number) | out、result(boolean)、error(string) |  |
| `loop` | 循环 | interpreter | — | in、mode(string)、count(number)、list(any)、expression(string)、max_iterations(number) | body、done、index(number)、count(number)、item(any)、key(any)、result(number) |  |
| `try_catch` | 异常捕获 | interpreter | — | in | try、catch、finally、error_message(string)、result(string) |  |
| `wait_input` | 等待回复 | handler:wait_input | — | in、prompt(string)、scope(string)、target_user(string)、timeout(number)、expected_pattern(string)、invalid_message(string)、max_retries(number) | out、timeout、reply(string)、user_id(string)、timed_out(boolean)、is_valid(boolean) |  |
| `loop_control` | 流程控制 | handler:loop_control | — | in、mode(string)、value(any) | out |  |
| `error_op` | 错误操作 | handler:error_op | — | in、condition(boolean)、message(string) | out、passed(boolean)、error(string) |  |
| `parallel_exec` | 并行执行 | interpreter | — | in、branches(json) | out、results(list)、count(number)、error(string) |  |
| `subflow_defined` | 子流程定义 | trigger | — | — | next |  |
| `subflow_call` | 调用子流程 | interpreter | — | in、args(json) | out、result(any)、error(string) |  |
| `retry_exec` | 重试执行 | interpreter | — | in、max_retries(number)、delay(number) | body、success、failed、attempts(number)、error(string) |  |
| `timer` | 计时器 | handler:timer | — | in、mode(string)、timer_id(string) | out、elapsed(number)、elapsed_ms(number)、error(string) |  |
| `start_node` | 开始 | trigger | — | — | next、event(event)、raw_message(string)、args(list)、matched(string)、groups(list)、time(datetime) |  |
| `end_node` | 结束 | handler:end_node | — | in | — |  |

## 数据（11）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `variable_set` | 变量赋值 | handler:variable_set | — | in、var_name(string)、value(any) | out、result(any)、error(string) |  |
| `variable_merge` | 变量聚合 | handler:variable_merge | — | in、mode(string)、v1(any)、v2(any)、v3(any)、v4(any)、v5(any)、v6(any)、key_names(json) | out、result(any)、count(number)、error(string) |  |
| `json_op` | JSON 操作 | handler:json_op | — | in、mode(string)、source_from(string)、source(any)、var_name(string)、write_back(boolean)、key(string)、value(string) | out、result(any)、error(string) |  |
| `file_read` | 读文件 | handler:fileRead | 读文件 | in、mode(string)、file_path(string)、encoding(string) | out、result(any)、success(boolean)、exists(boolean)、is_file(boolean)、is_dir(boolean)、count(number)、error(string) |  |
| `file_write` | 写文件 | handler:fileWrite | 写文件 | in、mode(string)、file_path(string)、dest_path(string)、content(any)、write_mode(string)、encoding(string)、append(boolean) | out、success(boolean)、path(string)、size(number)、error(string) |  |
| `list_op` | 列表操作 | handler:list_op | 列表操作 | in、mode(string)、source_from(string)、source_list(list)、var_name(string)、write_back(boolean)、item(any)、index(number)、start(number)、end(number)、key_field(string)、count_field(string)、delta(number) | out、result(any)、changed(boolean)、count(number)、total(number)、error(string) | 已弃用（2026-10-03） |
| `list_edit` | 列表增删改 | handler:list_edit | 列表增删改 | in、mode(string)、source_from(string)、source_list(list)、var_name(string)、write_back(boolean)、item(any)、index(number)、key_field(string)、count_field(string)、delta(number) | out、result(any)、changed(boolean)、count(number)、total(number)、error(string) |  |
| `list_query` | 列表查询 | handler:list_query | 列表查询 | in、mode(string)、source_from(string)、source_list(list)、var_name(string)、item(any)、index(number) | out、result(any)、changed(boolean)、count(number)、total(number)、error(string) |  |
| `list_transform` | 列表排序变换 | handler:list_transform | 列表排序变换 | in、mode(string)、source_from(string)、source_list(list)、var_name(string)、write_back(boolean) | out、result(any)、changed(boolean)、count(number)、total(number)、error(string) |  |
| `list_combine` | 列表合并切片 | handler:list_combine | 列表合并切片 | in、mode(string)、source_from(string)、source_list(list)、var_name(string)、write_back(boolean)、item(any)、start(number)、end(number)、index(number) | out、result(any)、changed(boolean)、count(number)、total(number)、error(string) |  |
| `config_query` | 查配置表 | handler:config_query | 查询配置表 | in、mode(string)、table(string)、db_path(string)、where(string)、where_params(any)、order(string)、limit(number)、field(string) | out、rows(list)、count(number)、first(object)、value(any)、success(boolean)、error(string) |  |

## AI（3）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `embedding` | 文本向量化 | handler:embedding | 文本向量化 | in、text(string) | out、vector(list)、dimensions(number)、error(string) |  |
| `agent_chat` | AI 智能体对话 | handler:agent_chat | AI 智能体对话 | in、mode(string)、prompt(string)、history(list)、system_prompt(string)、temperature(number)、max_rounds(number)、confirm_high_risk(boolean)、tools(list) | out、response(string)、tool_calls(list)、error(string) |  |
| `intent_classify` | 意图识别 | handler:intent_classify | — | in、user_message(string)、intents(json)、system_prompt(string)、temperature(number) | out、intent(string)、confidence(number)、all_scores(json)、error(string) |  |

## 存储（10）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `variable_persist` | 持久化操作 | handler:variable_persist | 持久化操作 | in、mode(string)、key(string)、value(any)、scope(string)、ttl(number)、default(any)、amount(number)、auto_save(boolean)、keys(string)、data(string)、item(any)、max_length(number)、compare_op(string)、threshold(number)、delta(number) | out、failed、result(any)、reason(string)、success(boolean)、error(string)、exists(boolean)、is_default(boolean)、old_value(any)、values(object)、count(number)、saved(number)、keys_list(list)、failed_key(string)、length(number)、new(boolean) | 已弃用（2026-10-03） |
| `load_variable` | 读玩家数据 | handler:loadVariable | 读玩家数据 | in、mode(string)、key(string)、keys(string)、default(any)、scope(string) | out、failed、result(any)、exists(boolean)、is_default(boolean)、values(object)、count(number)、success(boolean)、error(string) |  |
| `save_variable` | 写玩家数据 | handler:saveVariable | 写玩家数据 | in、mode(string)、key(string)、value(any)、ttl(number)、auto_save(boolean)、keys(string)、data(string)、scope(string) | out、failed、result(any)、success(boolean)、error(string)、saved(number)、keys_list(list)、failed_key(string) |  |
| `incr_variable` | 自增 | handler:incrVariable | 自增 | in、key(string)、amount(number)、scope(string) | out、result(any)、failed、new(boolean)、old_value(any)、success(boolean)、error(string) |  |
| `update_if_variable` | 条件更新 | handler:updateIfVariable | 条件更新 | in、key(string)、compare_op(string)、threshold(number)、delta(number)、scope(string) | out、result(any)、failed、new(boolean)、old_value(any)、success(boolean)、error(string) |  |
| `append_variable` | 列表追加 | handler:appendVariable | 列表追加 | in、key(string)、item(any)、max_length(number)、scope(string) | out、result(any)、failed、length(number)、success(boolean)、error(string) |  |
| `delete_variable` | 删玩家数据 | handler:deleteVariable | 删玩家数据 | in、key(string)、scope(string) | out、failed、success(boolean)、error(string) |  |
| `exists_variable` | 判断存在 | handler:existsVariable | 判断存在 | in、key(string)、scope(string) | out、failed、exists(boolean)、success(boolean)、error(string) |  |
| `query` | 批量查询 | handler:query | 查询数据库 | in、mode(string)、key_pattern(string)、scope(string)、limit(number)、filter_expr(string)、aggregate_func(string) | out、results(list)、count(number)、error(string) |  |
| `database_write` | 数据库操作 | handler:database_write | 数据库写入 | in、mode(string)、table(string)、data(json)、condition(string)、where_params(any)、order(string)、db_path(string)、result_field(string)、limit(number) | out、success(boolean)、lastrowid(number)、rows_updated(number)、rows_deleted(number)、rows(list)、rows_count(number)、value(any)、found(boolean)、error(string) |  |

## 计算（6）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `random` | 随机 | handler:random | — | in、mode(string)、min_value(number)、max_value(number)、items(json) | out、result(any)、error(string) |  |
| `time_op` | 时间操作 | handler:time_op | 时间操作 | in、mode(string)、fmt(string)、timezone(string)、timestamp(number)、target(string)、unit(string)、target_fmt(string)、offset(number) | out、timestamp(number)、datetime(string)、date(string)、time(string)、weekday(number)、result(any)、diff(number)、seconds(number)、is_past(boolean)、error(string) | 已弃用（2026-10-03） |
| `time_read` | 读时间 | handler:timeRead | 读时间 | in、mode(string)、timestamp(number)、fmt(string)、timezone(string)、unit(string) | out、result(any)、timestamp(number)、datetime(string)、date(string)、time(string)、weekday(number)、error(string) |  |
| `time_check` | 判断是否今天 | handler:timeCheck | 判断是否今天 | in、timestamp(number)、timezone(string) | out、result(any)、error(string) |  |
| `time_calc` | 算时间 | handler:timeCalc | 算时间 | in、mode(string)、timestamp(number)、target(string)、unit(string)、offset(number)、target_fmt(string)、fmt(string)、timezone(string) | out、result(any)、diff(number)、seconds(number)、is_past(boolean)、error(string) |  |
| `expression_eval` | 表达式求值 | handler:expression_eval | 表达式求值 | in、expression(string)、variables_json(any)、v1(any)、v2(any)、v3(any)、v4(any)、v5(any)、v6(any)、v7(any)、v8(any)、v9(any)、v10(any)、v11(any)、mode(string)、formulas(json) | out、result(any)、error(string) |  |

## 上下文（4）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `get_context` | 获取上下文（旧版，已拆分） | handler:get_context | 获取上下文 | in、mode(string)、index(number)、group_id(string)、user_id(string)、cursor(string)、part_mode(string) | out、result(any)、args_list(list)、members(list)、part_list(list)、part_count(number)、card(string)、nickname(string)、next_cursor(string)、role(string)、is_admin(boolean)、recv_msg_setting(string)、mute_mode(string)、mute_rules(any)、muted_members(list)、success(boolean)、error(string) | 已弃用（2026-10-03） |
| `get_ids` | 取身份 ID | handler:get_ids | 取身份 ID | in、mode(string) | out、result(any)、success(boolean)、error(string) |  |
| `get_message` | 取消息内容 | handler:get_message | 取消息内容 | in、mode(string)、index(number)、part_mode(string) | out、result(any)、args_list(list)、part_list(list)、part_count(number)、success(boolean)、error(string) |  |
| `get_profile` | 查资料（需调接口） | handler:get_profile | 查资料（需调接口） | in、mode(string)、group_id(string)、user_id(string)、cursor(string) | out、result(any)、nickname(string)、card(string)、members(list)、next_cursor(string)、role(string)、is_admin(boolean)、recv_msg_setting(string)、mute_mode(string)、mute_rules(any)、muted_members(list)、success(boolean)、error(string) |  |

## 文本（2）

| kind | 名称 | 执行 | 暴露工具 | 输入端口 | 输出端口 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `format_text` | 文本模板 | handler:format_text | 文本模板 | in、template(string)、variables_json(any)、var1(any)、var2(any)、var3(any)、var4(any)、var5(any)、var6(any)、var7(any)、var8(any) | out、result(string)、error(string) |  |
| `regex_extract` | 正则提取 | handler:regex_extract | — | in、text(string)、pattern(string)、group(number)、as_list(boolean) | out、result(any)、matched(boolean)、error(string) |  |

## 已弃用节点

| kind | 名称 | 弃用版本 | 替代节点 | 原因 |
| --- | --- | --- | --- | --- |
| `file_operate` | 文件操作 | 2026-10-03 | `file_read`、`file_write` | 8 个模式里「只读」与「会改磁盘」混在一起：前者安全、后者不可逆，选错可能删文件 |
| `list_op` | 列表操作 | 2026-10-03 | `list_edit`、`list_query`、`list_transform`、`list_combine` | 14 个模式（全仓最宽）：增删改/查询/排序变换/合并切片的接线方式完全不同 |
| `variable_persist` | 持久化操作 | 2026-10-03 | `load_variable`、`save_variable`、`incr_variable`、`update_if_variable`、`append_variable`、`delete_variable`、`exists_variable` | 11 个模式 + 16 入 16 出：存/取/删/自增的接线方式完全不同，选错就连错线 |
| `time_op` | 时间操作 | 2026-10-03 | `time_read`、`time_check`、`time_calc` | 8 个模式里「读取 / 判断 / 计算」的输入输出完全不同，混在一个下拉里会选错 |
| `get_context` | 获取上下文（旧版，已拆分） | 2026-10-03 | `get_ids`、`get_message`、`get_profile` | 19 个模式 + 17 个输出端口：选完模式面板上还挂着 16 个无关输出，AI 也拿不到单一语义 |
