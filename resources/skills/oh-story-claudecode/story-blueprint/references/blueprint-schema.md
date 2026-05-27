# 叙事蓝图输出Schema

## 完整YAML结构

```yaml
master_blueprint:

  metadata:
    project_title: "书名"
    genre: "类型"
    target_length:
      total_chapters: "500"
      words_per_chapter: "2500"
      estimated_total_words: "125万"
    core_premise: "一句话核心概念"
    unique_selling_points: ["卖点1", "卖点2"]
    target_audience: "目标读者"

  macro_structure:
    narrative_framework: "整体框架"
    volume_architecture:
      - volume_id: "vol_01"
        title: "卷标题"
        chapters: "1-80"
        word_count_estimate: "20万字"
        function: "结构功能"
        arc_summary: "剧情概要(200-300字)"
        key_characters_introduced: ["角色ID"]
        world_building_scope:
          revealed: ["已揭示设定"]
          foreshadowed: ["暗示设定"]
        thematic_focus: ["主题"]
        climax_chapter: "75"
        climax_event: "高潮事件"
        ending_hook: "卷末钩子"
        tone_progression: "情绪曲线"

  milestone_timeline:
    major_milestones:
      - milestone_id: "ms_001"
        chapter: "1"
        event_name: "事件名"
        description: "描述"
        narrative_function: "叙事功能"
        affected_characters: ["角色ID"]
        world_state_before: "前状态"
        world_state_after: "后状态"
        foreshadowing_planted: ["伏笔ID"]
        foreshadowing_resolved: ["伏笔ID"]
    minor_nodes:
      - node_id: "node_010"
        chapter: "10"
        event: "事件"
        function: "功能"

  foreshadowing_master_ledger:
    ledger_overview:
      total_count: "80-150条"
      layers:
        - layer: "明线伏笔"
          count: "30-50条"
        - layer: "暗线伏笔"
          count: "40-80条"
        - layer: "元伏笔"
          count: "10-20条"
    core_foreshadowing:
      - foreshadowing_id: "fsd_001"
        type: "明线/暗线/元伏笔"
        layer: "主线核心"
        description: "描述"
        lifecycle:
          planted_chapter: "12"
          planted_method: "埋设方式"
          clues_timeline:
            - chapter: "35"
              clue: "线索内容"
              clue_type: "信息补充/范围缩小/动机暗示"
          payoff_chapter: "267"
          payoff_method: "揭示方式"
          payoff_impact: "影响"
        connections: ["关联伏笔"]

  character_arc_trajectories:
    - character_id: "char_001"
      name: "角色名"
      role: "protagonist/mentor/antagonist"
      arc_type: "positive_change_arc/fall_arc/corruption_arc"
      arc_summary: "弧线概要"
      psychological_need: "心理需求"
      want_vs_need:
        surface_want: "表面目标"
        deep_need: "深层需求"
      lie_believed: "初始谎言"
      truth_learned: "最终真理"
      growth_stages:
        - stage: "阶段名"
          chapters: "1-50"
          state: "状态"
          characteristics: ["特征"]
          key_moment_chapters: ["关键章节"]
      relationship_arcs:
        - with: "角色ID"
          progression: "关系发展"
      power_progression:
        - stage: "等级"
          chapters: "范围"
          capabilities: "能力"

  pacing_rhythm_map:
    design_philosophy: "设计哲学"
    tension_curve:
      - chapter_range: "1-10"
        tension_level: 2
        description: "描述"
        pacing: "节奏"
    climax_chapters:
      - chapter: "75"
        intensity: "8/10"
        type: "类型"
    relief_sequences:
      - chapters: "31-49"
        function: "功能"
        tone: "基调"
    rhythm_formula: "节奏公式"

  thematic_progression:
    core_themes:
      - theme_id: "theme_01"
        theme_name: "主题名"
        thesis: "正题"
        antithesis: "反题"
        synthesis: "合题"
        evolution_timeline:
          - chapter_range: "1-100"
            stage: "探索期"
            manifestation: "表现"
            key_scenes: ["关键场景"]
        symbolic_carriers: ["象征载体"]

  worldbuilding_rollout:
    revelation_strategy: "揭示策略"
    setting_layers:
      - layer_id: "layer_surface"
        layer_name: "表层设定"
        reveal_chapters: "1-50"
        content: ["设定内容"]
        exposition_method: "交代方式"
    consistency_rules:
      - rule_id: "rule_001"
        rule: "规则内容"
        established_chapter: "确立章节"
        must_comply_throughout: true

  plotline_threads:
    - thread_id: "plot_main"
      thread_name: "主线名"
      priority: "最高/高/中"
      chapters: "1-500"
      major_beats: ["节拍"]
      resolution: "解决方式"

  execution_checklist:
    pre_writing_validation: ["检查项"]
    milestone_review_points:
      - checkpoint: "每50章"
        check_items: ["检查项"]
    sustainability_warnings:
      - warning: "警告类型"
        trigger: "触发条件"
        solution: "解决方案"
```

## 设计约束

- 每个里程碑必须有具体章节范围和事件描述
- 所有伏笔必须有ID和完整生命周期
- 角色成长曲线至少5个阶段
- 节奏曲线不允许连续50章平淡
- 主题每100章至少深度触及1次
