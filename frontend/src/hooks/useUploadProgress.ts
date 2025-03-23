import { useState, useEffect } from "react";

interface UseUploadProgressProps {
  /** Whether an upload is currently in progress */
  isUploading?: boolean;
  /** How frequently to update the progress (in ms) */
  updateInterval?: number;
  /** Maximum progress to reach during simulation (0-100) */
  maxSimulatedProgress?: number;
}

/**
 * Hook to simulate file upload progress for better UX
 */
export function useUploadProgress({
  isUploading = false,
  updateInterval = 200,
  maxSimulatedProgress = 90,
}: UseUploadProgressProps = {}) {
  const [uploadProgress, setUploadProgress] = useState(0);

  // Simulate progress updates for better UX
  useEffect(() => {
    if (!isUploading) {
      // Reset progress when not uploading, but with a slight delay
      // to show completion momentarily
      if (uploadProgress !== 0) {
        const timer = setTimeout(() => {
          setUploadProgress(0);
        }, 500); // Show 100% for a moment before resetting
        return () => clearTimeout(timer);
      }
      return;
    }

    // Create a realistic progress simulation that slows down as it approaches the maximum
    const simulateProgress = () => {
      // Calculate a random increment that slows down as it approaches maxSimulatedProgress
      const getIncrement = (current: number) => {
        const remainingToMax = maxSimulatedProgress - current;
        if (remainingToMax <= 0) return 0;
        // Smaller increments as we get closer to max
        return Math.max(0.5, Math.random() * (remainingToMax / 10));
      };

      setUploadProgress((prev) => {
        // Cap at maxSimulatedProgress for simulated progress
        // The final jump to 100% happens when upload is complete
        const increment = getIncrement(prev);
        return Math.min(maxSimulatedProgress, prev + increment);
      });
    };

    // Start simulation and update at the specified interval
    const timer = setInterval(simulateProgress, updateInterval);

    // Complete to 100% when upload is done
    if (uploadProgress >= maxSimulatedProgress) {
      clearInterval(timer);
      setUploadProgress(100);
    }

    return () => clearInterval(timer);
  }, [isUploading, uploadProgress, maxSimulatedProgress, updateInterval]);

  return uploadProgress;
}
