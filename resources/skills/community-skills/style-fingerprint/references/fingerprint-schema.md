# 风格指纹输出Schema

## 完整YAML结构

```yaml
author_fingerprint:

  # ========== 叙事层 ==========
  narrative_architecture:
    pov_system:
      primary_type: "第X人称/限知/全知/双线"
      pov_constraints: "具体限制规则"
      reliability: "可靠/不可靠叙述者"
      example_markers: ["典型句式1", "典型句式2"]
    
    time_structure:
      chronology: "线性/倒叙/插叙频率"
      scene_vs_summary_ratio: "场景XX% vs 概述XX%"
      flashback_pattern: "触发条件、长度、过渡句式"
    
    chapter_mechanics:
      avg_word_count: "XXXX-XXXX字"
      opening_formula: "对话XX%/场景XX%/悬念XX%"
      ending_formula: "悬念钩子XX%/情绪高潮XX%/过渡XX%"
      cliff_hanger_frequency: "每N章一次重大悬念"

  # ========== 语言层 ==========
  linguistic_signature:
    sentence_architecture:
      length_distribution:
        short_sentences: "<15字占XX%，用于：动作/对话"
        medium_sentences: "15-40字占XX%，用于：叙述主体"
        long_sentences: ">40字占XX%，用于：心理/环境"
      syntactic_patterns:
        - pattern: "具体句式"
          frequency: "高/中/低"
          usage_context: "使用场景"
      punctuation_habits:
        ellipsis_usage: "频率及场景"
        dash_usage: "用途及频率"
        exclamation_restraint: "密度评级"
    
    lexical_dna:
      signature_vocabulary:
        - category: "动作动词"
          examples: ["高频词1", "高频词2"]
          avoidance: ["刻意避免的词"]
        - category: "情感形容词"
          examples: ["偏好词汇"]
          intensity_preference: "克制/强烈/诗化"
      imagery_system:
        metaphor_sources: ["常用喻体领域"]
        simile_frequency: "明喻vs暗喻比例"
        synesthesia_use: "通感使用情况"
      register_control:
        formality_level: "书面语XX% vs 口语XX%"
        archaic_terms: "文言使用程度"
        neologisms: ["自创术语/网络用语"]
    
    rhythm_markers:
      repetition_for_effect:
        - type: "重复类型"
          example: "原文引用"
      paragraph_breath:
        avg_sentences_per_paragraph: "X-X句"
        single_sentence_paragraphs: "频率及用途"
      information_density: "每百字信息量评级"

  # ========== 对话层 ==========
  dialogue_system:
    quantitative:
      dialogue_percentage: "全文XX%"
      avg_exchange_length: "连续X-X轮"
    mechanical_rules:
      attribution_style:
        tag_frequency: "每X句1次"
        tag_vocabulary: ["说", "道", "问"]
        adverb_policy: "禁止/偶尔/常用"
      formatting:
        quotation_marks: "引号类型"
        paragraph_break: "分段规则"
        action_beats: "动作插入频率"
    linguistic_features:
      naturalism_level: "口语化程度"
      character_differentiation: "区分方法"
      subtext_encoding: "潜台词呈现方式"

  # ========== 描写层 ==========
  descriptive_protocol:
    scene_setting:
      entry_detail_level: "全景/焦点/延迟"
      sensory_priority: "视觉XX% > 听觉XX% > 其他"
      environment_update_frequency: "每X段更新"
    character_portrayal:
      physical_description: "集中/分散/极简"
      internal_access: "直接独白/间接转述/行为暗示"
      emotion_showing_vs_telling: "展示XX% vs 告知XX%"
    action_choreography:
      blow_by_blow_detail: "分解步骤数"
      speed_control: "慢镜头/快进标志"

  # ========== 禁忌层 ==========
  forbidden_patterns:
    absolute_bans:
      - type: "词汇黑名单"
        examples: ["禁用词1", "禁用词2"]
      - type: "句式禁忌"
        examples: ["禁用句式"]
      - type: "叙事违禁"
        examples: ["叙事禁忌"]
    stylistic_constraints:
      - "约束1"
      - "约束2"
    logical_consistency:
      - "POV一致性规则"
      - "时态一致性规则"

  # ========== 主题层 ==========
  thematic_execution:
    core_concerns: ["主题1", "主题2"]
    symbolism_system: "象征体系描述"
    philosophical_stance: "哲学立场及体现方式"

  # ========== 元数据 ==========
  technical_metadata:
    genre_markers: "类型元素呈现方式"
    pacing_formula: "高潮-缓冲比例"
    foreshadowing_density: "伏笔密度"
    world_building_method: "设定交代方式"
```

## 分析要求

- 样本文本建议5-10万字以上确保统计有效性
- 所有百分比需基于实际统计，非主观估计
- 示例引用必须来自原文
- 禁忌层需列出至少10个具体禁用词/句式
