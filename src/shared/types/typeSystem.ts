// src/shared/types/typeSystem.ts

// 16 种基础原子类型
export enum BaseType {
  Int = 'int',
  BigInt = 'bigint',
  Float = 'float',
  String = 'string',
  Text = 'text',
  Bool = 'bool',
  Enum = 'enum',
  DateTime = 'datetime',
  Duration = 'duration',
  List = 'list',
  Dict = 'dict',
  Set = 'set',
  Ref = 'ref',
  Json = 'json',
  Color = 'color',
  Image = 'image',
  Url = 'url',
}

// 字段描述
export interface FieldConfig {
  type: BaseType | string; // string = 自定义复合类型名称
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  // 不同类型专用配置
  enumValues?: string[]; // Enum 类型
  min?: number; // Int/Float
  max?: number; // Int/Float
  step?: number; // Float
  precision?: number; // Float 小数位
  maxLength?: number; // String/Text
  rows?: number; // Text 多行显示行数
  itemType?: FieldConfig; // List 元素类型
  keyType?: FieldConfig; // Dict key 类型
  valueType?: FieldConfig; // Dict value 类型
  refTable?: string; // Ref 引用的表名
  refField?: string; // Ref 引用的字段名
  refLabel?: string; // Ref 显示字段
}

// 复合类型定义
export interface CompositeTypeDef {
  name: string;
  label: string;
  fields: Record<string, FieldConfig>;
}

// Schema 文件定义 (对应 .schema/*.schema.json)
export interface SchemaDefinition {
  table: string;
  label?: string;
  fields: Record<string, FieldConfig>;
}

// 类型注册表
export class TypeRegistry {
  private static composites = new Map<string, CompositeTypeDef>();

  static register(def: CompositeTypeDef): void {
    this.composites.set(def.name, def);
  }

  static get(name: string): CompositeTypeDef | undefined {
    return this.composites.get(name);
  }

  static getAll(): CompositeTypeDef[] {
    return Array.from(this.composites.values());
  }

  // 注册所有预置复合类型
  static registerDefaults(): void {
    this.register({
      name: 'equipment',
      label: '装备',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        icon: { type: BaseType.Image, label: '图标' },
        level: { type: BaseType.Int, label: '等级', min: 1 },
        rarity: {
          type: BaseType.Enum,
          label: '稀有度',
          enumValues: ['普通', '稀有', '史诗', '传说'],
        },
        atk: { type: BaseType.Int, label: '攻击力', min: 0 },
        def: { type: BaseType.Int, label: '防御力', min: 0 },
        attrs: { type: BaseType.Dict, label: '属性映射', valueType: { type: BaseType.Int } },
        setEff: { type: BaseType.Text, label: '套装效果' },
        slot: {
          type: BaseType.Enum,
          label: '装备槽位',
          enumValues: ['武器', '防具', '饰品', '护符'],
        },
      },
    });
    this.register({
      name: 'skill',
      label: '技能',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        icon: { type: BaseType.Image, label: '图标' },
        type: { type: BaseType.Enum, label: '类型', enumValues: ['主动', '被动'] },
        cooldown: { type: BaseType.Duration, label: '冷却时间' },
        damage: { type: BaseType.Int, label: '基础伤害', min: 0 },
        multiplier: { type: BaseType.Float, label: '倍率', min: 0, step: 0.1, precision: 2 },
        target: { type: BaseType.Enum, label: '目标类型', enumValues: ['单体', '群体', '自身'] },
        desc: { type: BaseType.Text, label: '描述' },
      },
    });
    this.register({
      name: 'pet',
      label: '宠物',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        icon: { type: BaseType.Image, label: '图标' },
        level: { type: BaseType.Int, label: '等级', min: 1 },
        intimacy: { type: BaseType.Int, label: '亲密度', min: 0 },
        rarity: {
          type: BaseType.Enum,
          label: '稀有度',
          enumValues: ['普通', '稀有', '史诗', '传说'],
        },
        attrs: { type: BaseType.Dict, label: '属性', valueType: { type: BaseType.Int } },
        skills: {
          type: BaseType.List,
          label: '技能',
          itemType: { type: 'skill' as unknown as BaseType },
        },
      },
    });
    this.register({
      name: 'mount',
      label: '坐骑',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        icon: { type: BaseType.Image, label: '图标' },
        speed: { type: BaseType.Float, label: '速度加成', min: 0, step: 0.1 },
        level: { type: BaseType.Int, label: '等级要求', min: 1 },
        bonus: { type: BaseType.Dict, label: '属性加成', valueType: { type: BaseType.Int } },
      },
    });
    this.register({
      name: 'item',
      label: '丹药/道具',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        icon: { type: BaseType.Image, label: '图标' },
        grade: { type: BaseType.Enum, label: '品级', enumValues: ['凡品', '良品', '极品', '仙品'] },
        effect: { type: BaseType.Dict, label: '效果', valueType: { type: BaseType.Int } },
        duration: { type: BaseType.Duration, label: '持续时间' },
        stackable: { type: BaseType.Bool, label: '可堆叠' },
      },
    });
    this.register({
      name: 'quest',
      label: '任务',
      fields: {
        title: { type: BaseType.String, label: '标题', required: true },
        desc: { type: BaseType.Text, label: '描述' },
        type: { type: BaseType.Enum, label: '类型', enumValues: ['日常', '主线', '支线', '周常'] },
        reward: { type: BaseType.List, label: '奖励', itemType: { type: BaseType.String } },
        repeatable: { type: BaseType.Bool, label: '可重复' },
      },
    });
    this.register({
      name: 'achievement',
      label: '成就',
      fields: {
        title: { type: BaseType.String, label: '标题', required: true },
        condition: { type: BaseType.Json, label: '条件' },
        reward: { type: BaseType.List, label: '奖励', itemType: { type: BaseType.String } },
        rarity: {
          type: BaseType.Enum,
          label: '稀有度',
          enumValues: ['普通', '稀有', '史诗', '传说'],
        },
      },
    });
    this.register({
      name: 'dungeon',
      label: '副本',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        minLevel: { type: BaseType.Int, label: '最低等级', min: 1 },
        maxPlayers: { type: BaseType.Int, label: '最大人数', min: 1 },
        duration: { type: BaseType.Duration, label: '限制时间' },
        rewards: { type: BaseType.List, label: '奖励', itemType: { type: BaseType.String } },
      },
    });
    this.register({
      name: 'guild',
      label: '公会',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        level: { type: BaseType.Int, label: '等级', min: 1 },
        members: { type: BaseType.List, label: '成员', itemType: { type: BaseType.String } },
        fund: { type: BaseType.BigInt, label: '资金' },
        created: { type: BaseType.DateTime, label: '创建时间' },
      },
    });
    this.register({
      name: 'ranking',
      label: '排行榜',
      fields: {
        type: { type: BaseType.Enum, label: '类型', enumValues: ['等级', '战力', '财富', '成就'] },
        scope: { type: BaseType.Enum, label: '范围', enumValues: ['全服', '公会'] },
        maxDisplay: { type: BaseType.Int, label: '显示数量', min: 1 },
        refresh: { type: BaseType.Duration, label: '刷新周期' },
      },
    });
    this.register({
      name: 'vip',
      label: 'VIP',
      fields: {
        level: { type: BaseType.Int, label: '等级', min: 0 },
        name: { type: BaseType.String, label: '名称' },
        price: { type: BaseType.Int, label: '价格', min: 0 },
        duration: { type: BaseType.Duration, label: '时长' },
        benefits: { type: BaseType.Dict, label: '权益', valueType: { type: BaseType.String } },
      },
    });
    this.register({
      name: 'signin',
      label: '签到',
      fields: {
        day: { type: BaseType.Int, label: '天数', min: 1 },
        reward: { type: BaseType.List, label: '奖励', itemType: { type: BaseType.String } },
        isDouble: { type: BaseType.Bool, label: '是否翻倍' },
        requireVip: { type: BaseType.Int, label: 'VIP要求', min: 0 },
      },
    });
    this.register({
      name: 'lottery',
      label: '抽奖',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        cost: { type: BaseType.Dict, label: '花费', valueType: { type: BaseType.Int } },
        rates: { type: BaseType.Dict, label: '概率', valueType: { type: BaseType.Float } },
        dailyLimit: { type: BaseType.Int, label: '每日限制', min: 0 },
      },
    });
    this.register({
      name: 'title',
      label: '称号',
      fields: {
        name: { type: BaseType.String, label: '名称', required: true },
        rarity: {
          type: BaseType.Enum,
          label: '稀有度',
          enumValues: ['普通', '稀有', '史诗', '传说'],
        },
        color: { type: BaseType.Color, label: '颜色' },
        attrBonus: { type: BaseType.Dict, label: '属性加成', valueType: { type: BaseType.Int } },
        expire: { type: BaseType.Duration, label: '过期时间' },
      },
    });
    this.register({
      name: 'trade',
      label: '交易',
      fields: {
        price: { type: BaseType.BigInt, label: '价格' },
        currency: { type: BaseType.Enum, label: '货币', enumValues: ['金币', '元宝', '积分'] },
        time: { type: BaseType.DateTime, label: '时间' },
        status: { type: BaseType.Enum, label: '状态', enumValues: ['在售', '已售', '下架'] },
      },
    });
  }
}
