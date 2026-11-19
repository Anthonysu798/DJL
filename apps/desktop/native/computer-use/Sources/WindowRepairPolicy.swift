enum WindowRepairDecision: Equatable { case none, wait, handoff, raiseSaved }
func windowRepairDecision(victim: Int32, foreground: Int32?, saved: UInt32?, current: UInt32?, targetIndex: Int?, savedIndex: Int?, identitiesValid: Bool) -> WindowRepairDecision {
    guard identitiesValid, foreground == victim else { return .handoff }
    guard let saved = saved else { return .none }
    guard let current = current else { return .wait }
    guard current == saved else { return .handoff }
    guard let targetIndex = targetIndex, let savedIndex = savedIndex,
          targetIndex >= 0, savedIndex >= 0, targetIndex != savedIndex else { return .wait }
    return targetIndex < savedIndex ? .raiseSaved : .none
}
