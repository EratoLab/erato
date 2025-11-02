import React from 'react';

interface FeatureSectionProps {
  title: string;
  description: string;
  imageUrl: string;
  imagePosition?: 'left' | 'right';
  backgroundColor?: 'white' | 'gray';
}

export default function FeatureSection({
  title,
  description,
  imageUrl,
  imagePosition = 'right',
  backgroundColor = 'white',
}: FeatureSectionProps) {
  const bgClasses = backgroundColor === 'white' 
    ? 'bg-white dark:bg-[#024231]' 
    : 'bg-gray-50 dark:bg-[#035e4a]';

  return (
    <div className={`overflow-hidden ${bgClasses} py-24 sm:py-32`}>
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 sm:gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-2 lg:items-start">
          {/* Content Section */}
          <div className={`flex flex-col justify-center ${imagePosition === 'right' ? '' : 'lg:order-last'}`}>
            <div className="max-w-xl">
              <h2 className="text-4xl font-semibold tracking-tight text-pretty text-gray-900 sm:text-5xl dark:text-white">
                {title}
              </h2>
              <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300">
                {description}
              </p>
            </div>
          </div>

          {/* Image Section */}
          <div className={`flex items-center ${imagePosition === 'right' ? '' : 'lg:order-first'}`}>
            <img
              alt={title}
              src={imageUrl}
              width={2432}
              height={1442}
              className="w-full rounded-xl"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

