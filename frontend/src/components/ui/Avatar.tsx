import React from "react";
import clsx from "clsx";
import Image from "next/image";

export interface AvatarProps {
  userProfile?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  };
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const Avatar = React.memo<AvatarProps>(
  ({ userProfile, size = "md", className }) => {
    const getInitials = () => {
      if (userProfile?.firstName && userProfile?.lastName) {
        return `${userProfile.firstName[0]}${userProfile.lastName[0]}`.toUpperCase();
      }
      if (userProfile?.username) {
        return userProfile.username[0].toUpperCase();
      }
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
          "relative rounded-full flex items-center justify-center shrink-0",
          "bg-theme-bg-accent text-theme-fg-primary font-medium",
          sizeClasses[size],
          className,
        )}
      >
        {userProfile?.avatarUrl ? (
          <Image
            src={userProfile.avatarUrl}
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
