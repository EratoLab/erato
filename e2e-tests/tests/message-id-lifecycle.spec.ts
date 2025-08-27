import { test, expect } from "@playwright/test";
import { TAG_CI } from "./tags";
import { chatIsReadyToChat, login, ensureOpenSidebar } from "./shared";

test.describe("Message ID Lifecycle Investigation", () => {
  test(
    "Track message ID replacement from temp to real server IDs",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await login(page, "admin@example.com");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      // Add console log interception to track message ID changes
      const consoleLogs: string[] = [];
      page.on('console', (msg) => {
        if (msg.text().includes('[MESSAGE_ID]') || msg.text().includes('temp-user') || msg.text().includes('0198eb')) {
          consoleLogs.push(`${Date.now()}: ${msg.text()}`);
        }
      });

      // Test data - we'll send these messages and track their ID lifecycle
      const testMessages = [
        "Message 1: First test message",
        "Message 2: Second test message", 
        "Message 3: Third test message",
        "Message 4: Fourth test message"
      ];

      const messageTracker: Array<{
        content: string;
        initialId?: string;
        currentId?: string;
        serverReplaced?: boolean;
        timestamp: number;
      }> = [];

      // Send messages one by one and track their IDs
      for (let i = 0; i < testMessages.length; i++) {
        const messageContent = testMessages[i];
        const startTime = Date.now();
        
        console.log(`[MESSAGE_LIFECYCLE] Sending message ${i + 1}: "${messageContent}"`);
        
        await textbox.fill(messageContent);
        await textbox.press("Enter");
        
        // Wait for message to appear in UI
        await chatIsReadyToChat(page);
        
        // Get current message elements and their IDs
        const userMessages = page.locator('[data-testid="message-user"]');
        const messageCount = await userMessages.count();
        
        console.log(`[MESSAGE_LIFECYCLE] After sending message ${i + 1}, found ${messageCount} user messages`);
        
        // Capture current state of all message IDs
        const currentMessageIds: string[] = [];
        for (let j = 0; j < messageCount; j++) {
          const messageId = await userMessages.nth(j).getAttribute("data-message-id");
          const content = await userMessages.nth(j).textContent();
          if (messageId) {
            currentMessageIds.push(messageId);
            console.log(`[MESSAGE_LIFECYCLE] Message ${j + 1}: ID="${messageId}", Content="${content?.slice(0, 50)}..."`);
          }
        }
        
        // Track this message's lifecycle
        messageTracker.push({
          content: messageContent,
          initialId: currentMessageIds[currentMessageIds.length - 1], // Latest message
          currentId: currentMessageIds[currentMessageIds.length - 1],
          serverReplaced: false,
          timestamp: startTime
        });
        
        // Wait a bit longer to see if IDs get updated
        console.log(`[MESSAGE_LIFECYCLE] Waiting for potential ID replacement...`);
        await page.waitForTimeout(2000); // Give time for server response
        
        // Check if any IDs changed after waiting
        const updatedMessageIds: string[] = [];
        const finalMessageCount = await userMessages.count();
        
        for (let j = 0; j < finalMessageCount; j++) {
          const messageId = await userMessages.nth(j).getAttribute("data-message-id");
          if (messageId) {
            updatedMessageIds.push(messageId);
          }
        }
        
        // Compare before/after IDs
        console.log(`[MESSAGE_LIFECYCLE] Before wait: [${currentMessageIds.join(', ')}]`);
        console.log(`[MESSAGE_LIFECYCLE] After wait:  [${updatedMessageIds.join(', ')}]`);
        
        // Check if any temp IDs were replaced
        for (let j = 0; j < Math.min(currentMessageIds.length, updatedMessageIds.length); j++) {
          if (currentMessageIds[j] !== updatedMessageIds[j]) {
            console.log(`[MESSAGE_LIFECYCLE] ✅ ID REPLACEMENT: ${currentMessageIds[j]} → ${updatedMessageIds[j]}`);
            if (j < messageTracker.length) {
              messageTracker[j].currentId = updatedMessageIds[j];
              messageTracker[j].serverReplaced = true;
            }
          }
        }
        
        // Add separator for readability
        console.log(`[MESSAGE_LIFECYCLE] ====== Completed message ${i + 1} ======`);
      }
      
      // Final analysis - check all messages and their ID states
      console.log(`[MESSAGE_LIFECYCLE] FINAL ANALYSIS:`);
      console.log(`[MESSAGE_LIFECYCLE] Total messages tracked: ${messageTracker.length}`);
      
      const finalUserMessages = page.locator('[data-testid="message-user"]');
      const finalCount = await finalUserMessages.count();
      
      console.log(`[MESSAGE_LIFECYCLE] Final message count in UI: ${finalCount}`);
      
      // Capture final state
      const finalMessageData: Array<{id: string, content: string, isTemp: boolean}> = [];
      
      for (let i = 0; i < finalCount; i++) {
        const messageId = await finalUserMessages.nth(i).getAttribute("data-message-id");
        const content = await finalUserMessages.nth(i).textContent();
        
        if (messageId && content) {
          const isTemp = messageId.startsWith("temp-user-");
          finalMessageData.push({
            id: messageId,
            content: content.trim(),
            isTemp
          });
          
          console.log(`[MESSAGE_LIFECYCLE] Final Message ${i + 1}:`);
          console.log(`  ID: ${messageId} ${isTemp ? '(TEMP - NOT REPLACED!)' : '(REAL UUID - REPLACED!)'}`);
          console.log(`  Content: ${content.slice(0, 100)}...`);
        }
      }
      
      // Test assertions to identify the pattern
      console.log(`[MESSAGE_LIFECYCLE] PATTERN ANALYSIS:`);
      
      let tempIdCount = 0;
      let realIdCount = 0;
      
      finalMessageData.forEach((msg, index) => {
        if (msg.isTemp) {
          tempIdCount++;
          console.log(`[MESSAGE_LIFECYCLE] ❌ Message ${index + 1} stuck with temp ID: ${msg.id}`);
        } else {
          realIdCount++;
          console.log(`[MESSAGE_LIFECYCLE] ✅ Message ${index + 1} has real ID: ${msg.id}`);
        }
      });
      
      console.log(`[MESSAGE_LIFECYCLE] SUMMARY:`);
      console.log(`[MESSAGE_LIFECYCLE] Messages with real IDs: ${realIdCount}/${finalCount}`);
      console.log(`[MESSAGE_LIFECYCLE] Messages stuck with temp IDs: ${tempIdCount}/${finalCount}`);
      
      // Hypothesis testing
      if (tempIdCount === 0) {
        console.log(`[MESSAGE_LIFECYCLE] 🎯 HYPOTHESIS: All IDs replaced correctly - no bug!`);
      } else if (realIdCount === 1 && tempIdCount > 0) {
        console.log(`[MESSAGE_LIFECYCLE] 🎯 HYPOTHESIS: Only first message gets real ID - race condition or sequential processing bug!`);
      } else if (tempIdCount === finalCount) {
        console.log(`[MESSAGE_LIFECYCLE] 🎯 HYPOTHESIS: No IDs ever get replaced - complete replacement mechanism failure!`);
      } else {
        console.log(`[MESSAGE_LIFECYCLE] 🎯 HYPOTHESIS: Partial replacement - complex race condition or timing issue!`);
      }
      
      // The test "passes" regardless - we're just investigating
      expect(finalCount).toBeGreaterThan(0);
    }
  );

  test(
    "Test fast vs slow message sending to identify race conditions",
    { tag: TAG_CI },
    async ({ page }) => {
      await page.goto("/");
      await login(page, "admin@example.com");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);

      const textbox = page.getByRole("textbox", { name: "Type a message..." });

      console.log(`[RACE_TEST] Testing FAST message sending (potential race condition)`);
      
      // Send 3 messages quickly (potential race condition)
      const fastMessages = ["Fast 1", "Fast 2", "Fast 3"];
      
      for (const message of fastMessages) {
        await textbox.fill(message);
        await textbox.press("Enter");
        await page.waitForTimeout(100); // Very short wait - force race condition
      }
      
      // Wait for all to process
      await page.waitForTimeout(5000);
      
      // Check IDs after fast sending
      const userMessages = page.locator('[data-testid="message-user"]');
      const fastCount = await userMessages.count();
      
      console.log(`[RACE_TEST] Fast sending results: ${fastCount} messages`);
      
      const fastResults: Array<{id: string, isTemp: boolean}> = [];
      for (let i = 0; i < fastCount; i++) {
        const messageId = await userMessages.nth(i).getAttribute("data-message-id");
        if (messageId) {
          const isTemp = messageId.startsWith("temp-user-");
          fastResults.push({id: messageId, isTemp});
          console.log(`[RACE_TEST] Fast message ${i + 1}: ${messageId} ${isTemp ? '(TEMP)' : '(REAL)'}`);
        }
      }
      
      // Clear chat and test slow sending
      console.log(`[RACE_TEST] Testing SLOW message sending (no race condition)`);
      
      // Start fresh chat - navigate directly to avoid UI state issues
      console.log(`[RACE_TEST] Navigating to new chat page directly`);
      await page.goto("/");
      await chatIsReadyToChat(page);
      await ensureOpenSidebar(page);
      
      const slowMessages = ["Slow 1", "Slow 2", "Slow 3"];
      
      for (const message of slowMessages) {
        await textbox.fill(message);
        await textbox.press("Enter");
        await chatIsReadyToChat(page); // Don't expect assistant response to avoid selector conflicts
        await page.waitForTimeout(2000); // Long wait - avoid race conditions
      }
      
      // Check IDs after slow sending
      const slowUserMessages = page.locator('[data-testid="message-user"]');
      const slowCount = await slowUserMessages.count();
      
      console.log(`[RACE_TEST] Slow sending results: ${slowCount} messages`);
      
      const slowResults: Array<{id: string, isTemp: boolean}> = [];
      for (let i = 0; i < slowCount; i++) {
        const messageId = await slowUserMessages.nth(i).getAttribute("data-message-id");
        if (messageId) {
          const isTemp = messageId.startsWith("temp-user-");
          slowResults.push({id: messageId, isTemp});
          console.log(`[RACE_TEST] Slow message ${i + 1}: ${messageId} ${isTemp ? '(TEMP)' : '(REAL)'}`);
        }
      }
      
      // Compare results
      const fastTempCount = fastResults.filter(r => r.isTemp).length;
      const slowTempCount = slowResults.filter(r => r.isTemp).length;
      
      console.log(`[RACE_TEST] COMPARISON:`);
      console.log(`[RACE_TEST] Fast sending - temp IDs: ${fastTempCount}/${fastResults.length}`);
      console.log(`[RACE_TEST] Slow sending - temp IDs: ${slowTempCount}/${slowResults.length}`);
      
      if (fastTempCount > slowTempCount) {
        console.log(`[RACE_TEST] 🎯 CONCLUSION: Race condition detected! Fast sending causes more temp IDs to persist.`);
      } else if (fastTempCount === slowTempCount && fastTempCount > 0) {
        console.log(`[RACE_TEST] 🎯 CONCLUSION: Not a race condition - systematic replacement failure regardless of speed.`);
      } else {
        console.log(`[RACE_TEST] 🎯 CONCLUSION: No clear race condition pattern detected.`);
      }
      
      expect(slowCount).toBeGreaterThan(0);
    }
  );
});