#import <ApplicationServices/ApplicationServices.h>
#import <unistd.h>

int main(void) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (source == NULL) return 1;

  CGEventRef keyDown = CGEventCreateKeyboardEvent(source, 9, true);
  CGEventRef keyUp = CGEventCreateKeyboardEvent(source, 9, false);
  if (keyDown == NULL || keyUp == NULL) {
    if (keyDown != NULL) CFRelease(keyDown);
    if (keyUp != NULL) CFRelease(keyUp);
    CFRelease(source);
    return 1;
  }

  CGEventSetFlags(keyDown, kCGEventFlagMaskCommand);
  CGEventSetFlags(keyUp, kCGEventFlagMaskCommand);
  CGEventPost(kCGHIDEventTap, keyDown);
  usleep(16000);
  CGEventPost(kCGHIDEventTap, keyUp);

  CFRelease(keyDown);
  CFRelease(keyUp);
  CFRelease(source);
  return 0;
}
