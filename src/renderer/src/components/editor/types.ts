// 代码编辑器里一个打开的文件（Tab + Monaco 内容）
export interface EditorFile {
  /** 项目内相对路径（Tab key / 保存 / 关闭都以它为准） */
  path: string;
  /** Tab 上显示的名字（文件名、.env、🧩 包名等） */
  label: string;
  /** 当前内容（打开时的磁盘内容；未保存修改另存在 CodeEditor 的 modifiedMap 里） */
  content: string;
  /** 只读：应用管理的文件（生成快照、flow.json）默认只读，用户可手动解锁 */
  readOnly?: boolean;
}
