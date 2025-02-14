import React, { memo } from 'react';
import { Avatar } from './Avatar';
import { DropdownMenu } from './DropdownMenu';
import { LogOutIcon } from './icons';
import type { UserProfile } from '../../types/chat';
import { clsx } from 'clsx';

interface UserProfileDropdownProps {
  userProfile?: UserProfile;
  onSignOut: () => void;
  className?: string;
}

export const UserProfileDropdown = memo<UserProfileDropdownProps>(({
  userProfile,
  onSignOut,
  className
}) => {
  const dropdownItems = [
    {
      label: 'Sign out',
      icon: <LogOutIcon className="w-4 h-4" />,
      onClick: onSignOut,
    }
  ];

  return (
    <div className={clsx('min-h-[40px] flex items-center', className)}>
      <DropdownMenu
        items={dropdownItems}
        align="left"
        // preferredOrientation={{
        //   vertical: 'top',
        //   horizontal: 'left'
        // }}
        triggerIcon={
          <Avatar 
            userProfile={userProfile} 
            size="sm"
            className="cursor-pointer hover:opacity-80 transition-opacity"
          />
        }
      />
    </div>
  );
});

UserProfileDropdown.displayName = 'UserProfileDropdown'; 