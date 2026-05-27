# 续写包 (continuation_pack) Schema

## 完整结构

```yaml
continuation_pack:

  batch_metadata:
    completed_chapters: ["X", "Y"]
    total_words_generated: "本批次总字数"
    story_progress_percentage: "15/500 = 3%"

  state_delta:

    characters_updated:
      - character_id: "char_XXX"
        changes:
          location:
            from: "原位置"
            to: "新位置"
            transition_method: "步行/传送/被押送"
          physical_state:
            - change_type: "injury/healing/exhaustion/power_up"
              description: "具体变化"
              cause: "第X章YY事件"
          mental_state:
            emotion_shift: "从XX转为YY"
            trigger: "触发事件"
            new_knowledge: ["新获知信息"]
          inventory_delta:
            added: ["物品(来源)"]
            removed: ["物品(去向)"]
            modified: ["物品：状态变化"]
          arc_progression: "阶段变化"
          unresolved_goals_update:
            completed: ["已完成目标"]
            added: ["新增目标"]

    relationships_delta:
      - relationship_id: "rel_XXX"
        status_change:
          from: "原状态"
          to: "新状态"
          pivot_event: "触发事件"
        new_tension_points: ["新矛盾"]

    foreshadowing_delta:
      planted_this_batch:
        - foreshadowing_id: "NEW_fsd_XXX"
          type: "明线/暗线/元伏笔"
          description: "内容"
          planted_method: "埋设方式"
          payoff_chapter: "预定揭示章节"
      advanced_this_batch:
        - foreshadowing_id: "fsd_YYY"
          clue_released: "释放的线索"
          remaining_clues: "剩余线索数"
      resolved_this_batch:
        - foreshadowing_id: "fsd_ZZZ"
          resolution_chapter: "X"
          resolution_method: "揭示方式"
          impact: "影响"

    environmental_changes:
      timeline_advancement:
        story_time_elapsed: "X天X小时"
        current_story_date: "当前时间点"
      world_state_changes:
        - change_type: "政治/自然/社会"
          description: "变化描述"
          impact_scope: "影响范围"

  quality_report:
    compliance_verification:
      pov_consistency: "✓/✗"
      dialogue_ratio: "实际比例"
      sentence_distribution: "实际分布"
      signature_words_usage: "使用情况"
      forbidden_patterns_check: "✓/✗"
    foreshadowing_execution:
      planted_count: "X条"
      resolved_count: "X条"
      ledger_health: "未解总数"
    pacing_assessment:
      conflict_intensity: "高潮/缓冲/过渡"
      next_peak_due: "下一高峰章节"

  next_batch_blueprint:
    target_chapters: ["X+1", "X+2"]
    narrative_function: "结构作用"
    pacing_designation: "节奏定位"
    detailed_outline:
      chapter_X_plus_1:
        chapter_number: "X+1"
        pov_character: "char_XXX"
        time_span: "故事时间"
        beat_sequence:
          - beat_id: "(X+1).1"
            beat_type: "类型"
            content: "内容"
            word_target: "XXX-XXX字"
            execution_specs:
              pacing: "节奏"
              sensory_focus: "感官"
              dialogue_quota: "对话占比"
    batch_level_planning:
      arc_progression: "弧线进展"
      foreshadowing_strategy:
        to_plant: ["计划埋设"]
        to_advance: ["计划推进"]
        to_resolve: ["计划回收"]
      thematic_reinforcement:
        theme: "强化主题"
        methods: ["方法"]

  next_iteration_instruction: |
    1. state_delta 合并到世界状态快照
    2. foreshadowing_delta 更新到伏笔登记簿
    3. next_batch_blueprint.detailed_outline → 下次本批次细纲
    4. 本批次最后一章全文 → 下次文风参考
```
