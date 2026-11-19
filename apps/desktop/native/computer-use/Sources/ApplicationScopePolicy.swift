// Process ownership rules over fresh kernel metadata; no app discovery.
enum ApplicationScopePolicy {
    static func ownsProcess(helperPID: Int32, processPID: Int32, userID: UInt32, processUserID: UInt32) -> Bool {
        helperPID > 0 && processPID > 0 && helperPID != processPID && userID == processUserID
    }
    static func permitsBackgroundPair(helperPID: Int32, targetPID: Int32, foregroundPID: Int32,
                                      userID: UInt32, targetUserID: UInt32, foregroundUserID: UInt32) -> Bool {
        targetPID != foregroundPID &&
            ownsProcess(helperPID: helperPID, processPID: targetPID, userID: userID, processUserID: targetUserID) &&
            ownsProcess(helperPID: helperPID, processPID: foregroundPID, userID: userID, processUserID: foregroundUserID)
    }
}
