#import <AppKit/AppKit.h>

// A detent on a Force Touch trackpad. AppKit plays it only while a finger rests on the trackpad,
// which is the case while the page is being dragged, and ignores it otherwise.
void index_haptic(bool strong) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSHapticFeedbackManager.defaultPerformer
        performFeedbackPattern:strong ? NSHapticFeedbackPatternLevelChange
                                      : NSHapticFeedbackPatternAlignment
               performanceTime:NSHapticFeedbackPerformanceTimeNow];
  });
}
