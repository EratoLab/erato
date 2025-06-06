import clsx from "clsx";
import Image from "next/image";
import React, { useMemo } from "react";

import { mapApiUserProfileToUiProfile } from "@/utils/adapters/userProfileAdapter";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface AvatarProps {
  userProfile?: UserProfile;
  // true = user
  // false = assistant
  userOrAssistant?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const Avatar = React.memo<AvatarProps>(
  ({ userProfile, userOrAssistant, size = "md", className }) => {
    const uiProfile = useMemo(
      () => mapApiUserProfileToUiProfile(userProfile),
      [userProfile],
    );

    const getInitials = () => {
      if (typeof userOrAssistant !== "undefined" && !userOrAssistant) {
        return "A"; // 'A' for Assistant
      }
      if (uiProfile?.name) {
        const nameParts = uiProfile.name.split(" ");
        return `${nameParts[0][0]}${nameParts[1] ? nameParts[1][0] : ""}`.toUpperCase();
      }
      // if (userProfile?.firstName && userProfile.lastName) {
      //   return `${userProfile.firstName[0]}${userProfile.lastName[0]}`.toUpperCase();
      // }
      // if (userProfile?.username) {
      //   return userProfile.username[0].toUpperCase();
      // }
      return "E"; // Default to 'E' for Erato
    };

    const sizeClasses = {
      sm: "min-w-[32px] w-8 h-8 text-sm",
      md: "min-w-[40px] w-10 h-10 text-base",
      lg: "min-w-[48px] w-12 h-12 text-lg",
    };

    return (
      <div
        className={clsx(
          "relative flex shrink-0 items-center justify-center rounded-full",
          !userOrAssistant
            ? "bg-theme-avatar-assistant-bg text-theme-avatar-assistant-fg"
            : "bg-theme-avatar-user-bg text-theme-avatar-user-fg",
          sizeClasses[size],
          className,
        )}
      >
        {uiProfile?.avatarUrl && !userOrAssistant ? (
          <Image
            src={uiProfile.avatarUrl}
            alt="User avatar"
            className="rounded-full object-cover"
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <span>{getInitials()}</span>
        )}
      </div>
    );
  },
);

Avatar.displayName = "Avatar";
