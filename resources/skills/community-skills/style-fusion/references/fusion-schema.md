# 融合创作指南输出Schema

## 完整YAML结构

```yaml
book_genesis:

  fusion_guide:

    narrative_framework:
      pov_implementation:
        applied_type: "第X人称+限制"
        viewpoint_constraints: "具体约束"
        reliability_mechanism: "可靠性机制"
        transition_rules: "切换规则"
        forbidden_violations: ["禁止项"]
      temporal_architecture:
        timeline_structure: "时间线结构"
        flashback_protocol:
          trigger_conditions: "触发条件"
          length_limit: "长度限制"
          transition_phrases: ["过渡句式"]
        scene_summary_ratio: "场景vs概述比例"
      chapter_execution_blueprint:
        target_word_count: "XXXX-XXXX字"
        opening_playbook:
          - pattern: "模式名"
            frequency: "XX%"
            template: "句式模板"
        ending_playbook:
          - pattern: "模式名"
            frequency: "XX%"
            execution: "执行规则"
        pacing_cycle:
          conflict_peak_frequency: "每X章"
          relief_chapter_ratio: "缓冲比例"

    linguistic_ruleset:
      sentence_construction_law:
        length_distribution_targets:
          short: "<15字占XX%"
          medium: "15-40字占XX%"
          long: ">40字占XX%"
        mandatory_patterns:
          - pattern_name: "句式名"
            usage_quota: "每千字X次"
            context_binding: "使用场景"
        punctuation_protocol:
          ellipsis: { frequency: "X次/千字", allowed_contexts: [] }
          dash: { function: "用途" }
          exclamation: { density_limit: "每章≤X个" }
      vocabulary_engineering:
        signature_lexicon:
          - domain: "领域"
            priority_words: ["词汇"]
            forbidden_synonyms: ["禁用"]
        imagery_construction_rules:
          metaphor_sourcing: "喻体来源领域"
          simile_vs_metaphor_ratio: "比例"
        register_maintenance:
          formality_baseline: "书面vs口语比例"
      rhythm_engineering:
        repetition_mechanics:
          - type: "类型"
            method: "方法"
        paragraph_dynamics:
          standard_length: "每段X-X句"
          single_sentence_paragraph: { frequency: "每章X处" }
        information_load_control:
          density_target: "每百字X个情节点"
          overload_prevention: "单段限制"

    dialogue_implementation:
      quantitative_targets:
        global_percentage: "XX%"
        consecutive_exchange_limit: "X轮"
      mechanical_specifications:
        attribution_system:
          tag_frequency_rule: "每X句1次"
          approved_verbs: ["说", "道", "问"]
          forbidden_verbs: ["禁用动词"]
          adverb_policy: "副词策略"
        formatting_standards:
          quotation_style: "引号类型"
          paragraph_rule: "分段规则"
      linguistic_characterization:
        character_voice_matrix:
          - character_type: "角色类型"
            lexical_features: "词汇特征"
            signature_phrases: ["专属口头禅"]

    descriptive_standards:
      scene_establishment:
        new_location_protocol:
          detail_level: "细节级别"
          mandatory_elements: ["时间", "空间", "氛围"]
          sensory_checklist: { visual: "XX%", auditory: "XX%" }
      character_portrayal_system:
        emotion_presentation:
          showing_techniques: ["技巧"]
          telling_allowance: "≤XX%"
      action_rendering:
        complexity_calibration:
          high_detail_scenes: "X-X步骤"
        kinetic_vocabulary: ["动能词汇"]

    prohibition_matrix:
      tier_1_absolute_bans:
        vocabulary_blacklist: ["禁用词"]
        syntax_violations: ["禁用句式"]
        narrative_crimes: ["叙事禁忌"]
      tier_2_stylistic_constraints: ["约束"]
      tier_3_quality_gates:
        - gate: "检查项"

  initial_story_state:

    world_snapshot:
      timeline_anchor: "时间锚点"
      geopolitical_state: "势力状态"
      active_macguffins: ["关键物品"]
      established_rules: ["世界规则"]

    character_registry:
      - character_id: "char_001"
        role: "protagonist"
        initial_condition:
          location: "位置"
          physical_state: "物理状态"
          mental_state: "心理状态"
          knowledge_level: "已知信息"
        inventory:
          essential_items: ["物品"]
        arc_stage: "成长阶段"
        unresolved_goals: ["目标"]

    relationship_matrix:
      - relationship_id: "rel_001"
        participants: ["char_A", "char_B"]
        current_status: "当前状态"
        tension_points: ["矛盾点"]
        trajectory: "预定发展"

    foreshadowing_ledger:
      - foreshadowing_id: "fsd_001"
        type: "类型"
        description: "描述"
        planted_in: "植入位置"
        clues_schedule:
          - chapter: "X"
            clue: "线索"
        payoff_chapter: "揭示章节"

    active_mysteries:
      - mystery_id: "mys_001"
        question: "问题"
        red_herrings: ["误导"]
        true_answer: "真实答案"
        revelation_chapter: "揭示章节"

    next_batch_outline:
      chapter_001:
        beat_breakdown:
          - beat_id: "1.1"
            beat_type: "类型"
            content: "内容"
            word_target: "XXX-XXX字"
            style_notes: "风格注释"
        compliance_checklist: ["检查项"]
```
